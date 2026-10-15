import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SourceChangedError,
  openRegularFile,
  readAgentMeta,
  readJsonlIncrement,
  stripInvisible,
} from '../src/parser/index.js';

const posix = process.platform !== 'win32';
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orbit-iosafe-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('stripInvisible (display-label spoofing, F-04)', () => {
  it('removes bidi overrides/isolates, zero-width and format characters and controls', () => {
    const bad = [
      ...Array.from({ length: 5 }, (_, i) => 0x202a + i),
      ...Array.from({ length: 4 }, (_, i) => 0x2066 + i),
      ...Array.from({ length: 5 }, (_, i) => 0x200b + i),
      ...Array.from({ length: 5 }, (_, i) => 0x2060 + i),
      0xfeff,
      0x0000,
      0x001b,
      0x007f,
      0x0085,
      0x2028,
      0x2029,
    ];
    for (const cp of bad) expect(stripInvisible(`a${String.fromCodePoint(cp)}b`), cp.toString(16)).toBe('ab');
    expect(stripInvisible('gnp‮e.exe')).toBe('gnpe.exe');
  });

  it('keeps ordinary text, accents and emoji', () => {
    expect(stripInvisible('Üretim-şef 🚀 proje_1')).toBe('Üretim-şef 🚀 proje_1');
  });
});

describe('post-open verification (F-06)', () => {
  it('reads a regular file whose dev/ino match', async () => {
    const f = join(dir, 'a.jsonl');
    writeFileSync(f, '{"a":1}\n');
    const st = statSync(f);
    const inc = await readJsonlIncrement(f, { fromOffset: 0, expectIdentity: { dev: st.dev, ino: st.ino } });
    expect(inc.lines).toHaveLength(1);
  });

  it('rejects a file whose inode changed after discovery', async () => {
    const f = join(dir, 'a.jsonl');
    writeFileSync(f, '{"a":1}\n');
    const st = statSync(f);
    await expect(readJsonlIncrement(f, { fromOffset: 0, expectIdentity: { dev: st.dev, ino: st.ino + 1 } })).rejects.toBeInstanceOf(
      SourceChangedError,
    );
    await expect(openRegularFile(f, { dev: st.dev + 1, ino: st.ino })).rejects.toBeInstanceOf(SourceChangedError);
  });

  it.skipIf(!posix)('does not follow a symlink swapped in at the final path component', async () => {
    const outside = join(dir, 'outside.jsonl');
    writeFileSync(outside, '{"canary":1}\n');
    const link = join(dir, 'link.jsonl');
    symlinkSync(outside, link);
    await expect(readJsonlIncrement(link, { fromOffset: 0 })).rejects.toThrow();
    expect(await readAgentMeta(link)).toBeNull();
  });

  it.skipIf(!posix)('rejects a FIFO without blocking', async () => {
    const fifo = join(dir, 'pipe.jsonl');
    try {
      execFileSync('mkfifo', [fifo]);
    } catch {
      return; // mkfifo unavailable in this environment
    }
    await expect(readJsonlIncrement(fifo, { fromOffset: 0 })).rejects.toBeInstanceOf(SourceChangedError);
    expect(await readAgentMeta(fifo)).toBeNull();
  });

  it('rejects directories', async () => {
    const d = join(dir, 'd.jsonl');
    mkdirSync(d);
    await expect(readJsonlIncrement(d, { fromOffset: 0 })).rejects.toThrow();
  });
});
