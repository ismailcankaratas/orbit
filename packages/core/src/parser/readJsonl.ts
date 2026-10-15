import { constants } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import { MAX_LINE_BYTES } from './parseLine.js';

export interface JsonlLine {
  text: string;
  /** Byte offset of the line start within the file. */
  offset: number;
  invalidUtf8: boolean;
  /** Line exceeded the byte cap; it was skipped without being buffered and text is ''. */
  tooLong: boolean;
}

export interface FileIdentity {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
}

export interface JsonlIncrement {
  lines: JsonlLine[];
  /** Byte offset after the last complete (newline-terminated) line consumed. */
  nextOffset: number;
  /** Bytes exist after nextOffset that are not yet newline-terminated (or were cut by maxBytes). */
  partialTrailing: boolean;
  /** fromOffset was beyond the file size: file was truncated/rotated; caller should rescan from 0. */
  truncated: boolean;
  fileIdentity: FileIdentity;
}

/** Thrown when the opened file is not the regular file that discovery saw (replaced, swapped for a symlink/FIFO, ...). */
export class SourceChangedError extends Error {
  readonly code = 'SOURCE_CHANGED';
  constructor() {
    super('Source file changed between discovery and read');
    this.name = 'SourceChangedError';
  }
}

/**
 * Open read-only without following a final symlink (O_NOFOLLOW where the platform has it), then verify with fstat
 * that the descriptor is a regular file and, when given, that dev/ino equal the values discovery recorded.
 * Closes the handle and throws {@link SourceChangedError} on mismatch.
 */
export async function openRegularFile(path: string, expect?: { dev: number; ino: number }): Promise<FileHandle> {
  // O_NONBLOCK: opening a swapped-in FIFO must not block a threadpool worker; regular files are unaffected.
  const fh = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const st = await fh.stat();
    if (!st.isFile() || (expect !== undefined && (st.dev !== expect.dev || st.ino !== expect.ino))) throw new SourceChangedError();
    return fh;
  } catch (e) {
    await fh.close().catch(() => undefined);
    throw e;
  }
}

export interface ReadJsonlOptions {
  /** Require the opened descriptor to have this dev/ino (post-open fstat); otherwise SourceChangedError. */
  expectIdentity?: { dev: number; ino: number };
  fromOffset: number;
  /** Max bytes to read in this increment (bounds work per call). */
  maxBytes?: number;
  maxLineBytes?: number;
}

const strict = new TextDecoder('utf-8', { fatal: true });
const lenient = new TextDecoder('utf-8', { fatal: false });

function decode(buf: Buffer): { text: string; invalid: boolean } {
  try {
    return { text: strict.decode(buf), invalid: false };
  } catch {
    return { text: lenient.decode(buf), invalid: true };
  }
}

export async function readJsonlIncrement(path: string, opts: ReadJsonlOptions): Promise<JsonlIncrement> {
  const maxLine = opts.maxLineBytes ?? MAX_LINE_BYTES;
  const from = Math.max(0, Math.floor(opts.fromOffset));
  const fh = await openRegularFile(path, opts.expectIdentity); // read-only, no symlink follow, fstat-verified
  try {
    const st = await fh.stat();
    const fileIdentity: FileIdentity = { dev: st.dev, ino: st.ino, size: st.size, mtimeMs: st.mtimeMs };
    if (from > st.size) {
      return { lines: [], nextOffset: from, partialTrailing: false, truncated: true, fileIdentity };
    }
    let endExclusive = st.size;
    if (opts.maxBytes !== undefined) endExclusive = Math.min(endExclusive, from + Math.max(1, opts.maxBytes));
    if (endExclusive <= from) {
      return { lines: [], nextOffset: from, partialTrailing: false, truncated: false, fileIdentity };
    }

    const lines: JsonlLine[] = [];
    let parts: Buffer[] = [];
    let curLen = 0;
    let overflow = false;
    let lineStart = from;
    let pos = from; // absolute offset of next byte to process
    let consumed = from;

    const stream = fh.createReadStream({ start: from, end: endExclusive - 1, autoClose: false });
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      let i = 0;
      while (i < chunk.length) {
        const nl = chunk.indexOf(0x0a, i);
        const segEnd = nl === -1 ? chunk.length : nl;
        const segLen = segEnd - i;
        if (!overflow) {
          if (curLen + segLen > maxLine) {
            overflow = true;
            parts = [];
          } else {
            parts.push(chunk.subarray(i, segEnd));
          }
        }
        curLen += segLen;
        pos += segLen;
        if (nl === -1) break;
        // complete line
        pos += 1;
        if (overflow) {
          lines.push({ text: '', offset: lineStart, invalidUtf8: false, tooLong: true });
        } else {
          let buf = parts.length === 1 ? (parts[0] as Buffer) : Buffer.concat(parts);
          if (buf.length > 0 && buf[buf.length - 1] === 0x0d) buf = buf.subarray(0, buf.length - 1);
          const { text, invalid } = decode(buf);
          lines.push({ text, offset: lineStart, invalidUtf8: invalid, tooLong: false });
        }
        parts = [];
        curLen = 0;
        overflow = false;
        lineStart = pos;
        consumed = pos;
        i = nl + 1;
      }
    }
    return {
      lines,
      nextOffset: consumed,
      partialTrailing: consumed < Math.min(st.size, endExclusive),
      truncated: false,
      fileIdentity,
    };
  } finally {
    await fh.close().catch(() => undefined);
  }
}
