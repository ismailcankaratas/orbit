import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { SourceKind } from '../schemas/types.js';
import { isSafeId } from '../parser/sanitize.js';

export type DiscoveryErrorCode = 'SOURCE_NOT_FOUND' | 'PERMISSION_DENIED';

export class DiscoveryError extends Error {
  readonly code: DiscoveryErrorCode;
  constructor(code: DiscoveryErrorCode) {
    super(code === 'SOURCE_NOT_FOUND' ? 'Source root not found' : 'Source root is not readable');
    this.name = 'DiscoveryError';
    this.code = code;
  }
}

export interface DiscoveredSource {
  /** Opaque id: first 24 hex of sha256(realpath). Safe for APIs. */
  sourceFileId: string;
  kind: SourceKind;
  /** SERVER-INTERNAL. Never serialize. */
  localPath: string;
  /** SERVER-INTERNAL. Sibling agent-*.meta.json when present. */
  metaLocalPath: string | null;
  /** SERVER-INTERNAL encoded project folder name. */
  projectDirName: string;
  sessionId: string;
  agentId: string | null;
  size: number;
  mtimeMs: number;
  ino: number;
  dev: number;
}

export interface DiscoveryDiagnostics {
  symlinksSkipped: number;
  oversizeSkipped: number;
  ignoredFiles: number;
  unreadable: number;
}

export interface DiscoveryResult {
  sources: DiscoveredSource[];
  diagnostics: DiscoveryDiagnostics;
}

export interface DiscoverOptions {
  /** Default 2 GiB. */
  maxFileBytes?: number;
  /** Default 4. */
  maxDepth?: number;
  /** Test hook invoked before each lstat/realpath of a candidate path. */
  hooks?: { beforeStat?: (path: string) => Promise<void> | void };
}

export const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024;

/** True when `candidate` is `realRoot` or a descendant, lexically. Rejects null bytes and traversal. */
export function isInsideRoot(realRoot: string, candidate: string): boolean {
  if (typeof candidate !== 'string' || candidate.includes('\0') || realRoot.includes('\0')) return false;
  const rel = relative(realRoot, candidate);
  if (rel === '') return true;
  if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) return false;
  return true;
}

const SESSION_JSONL = /^(.+)\.jsonl$/;
const AGENT_JSONL = /^agent-(.+)\.jsonl$/;

export async function discoverSources(root: string, options: DiscoverOptions = {}): Promise<DiscoveryResult> {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxDepth = options.maxDepth ?? 4;
  const diagnostics: DiscoveryDiagnostics = { symlinksSkipped: 0, oversizeSkipped: 0, ignoredFiles: 0, unreadable: 0 };
  const sources: DiscoveredSource[] = [];

  let realRoot: string;
  try {
    realRoot = await realpath(root);
    const st = await lstat(realRoot);
    if (!st.isDirectory()) throw new DiscoveryError('SOURCE_NOT_FOUND');
    await readdir(realRoot); // verify readable
  } catch (e) {
    if (e instanceof DiscoveryError) throw e;
    const code = (e as NodeJS.ErrnoException).code;
    throw new DiscoveryError(code === 'EACCES' || code === 'EPERM' ? 'PERMISSION_DENIED' : 'SOURCE_NOT_FOUND');
  }

  const safeLstat = async (p: string, quietMissing = false): Promise<Stats | null> => {
    try {
      await options.hooks?.beforeStat?.(p);
      return await lstat(p);
    } catch (e) {
      if (!(quietMissing && (e as NodeJS.ErrnoException).code === 'ENOENT')) diagnostics.unreadable += 1;
      return null;
    }
  };

  const ls = async (dir: string): Promise<string[] | null> => {
    try {
      return (await readdir(dir)).sort();
    } catch {
      diagnostics.unreadable += 1;
      return null;
    }
  };

  const addFile = async (
    path: string,
    st: Stats,
    kind: SourceKind,
    projectDirName: string,
    sessionId: string,
    agentId: string | null,
    metaPath: string | null,
  ): Promise<void> => {
    if (st.size > maxFileBytes) {
      diagnostics.oversizeSkipped += 1;
      return;
    }
    let real: string;
    try {
      real = await realpath(path);
    } catch {
      diagnostics.unreadable += 1;
      return;
    }
    if (!isInsideRoot(realRoot, real)) {
      diagnostics.ignoredFiles += 1;
      return;
    }
    sources.push({
      sourceFileId: createHash('sha256').update(real).digest('hex').slice(0, 24),
      kind,
      localPath: real,
      metaLocalPath: metaPath,
      projectDirName,
      sessionId,
      agentId,
      size: st.size,
      mtimeMs: st.mtimeMs,
      ino: st.ino,
      dev: st.dev,
    });
  };

  // depth 1: project dirs
  for (const proj of (await ls(realRoot)) ?? []) {
    const projPath = join(realRoot, proj);
    if (proj.includes('\0') || !isInsideRoot(realRoot, projPath)) {
      diagnostics.ignoredFiles += 1;
      continue;
    }
    const pst = await safeLstat(projPath);
    if (!pst) continue;
    if (pst.isSymbolicLink()) {
      diagnostics.symlinksSkipped += 1;
      continue;
    }
    if (!pst.isDirectory()) {
      diagnostics.ignoredFiles += 1;
      continue;
    }
    if (maxDepth < 2) continue;

    // depth 2: session files / session dirs
    for (const name of (await ls(projPath)) ?? []) {
      const p2 = join(projPath, name);
      if (!isInsideRoot(realRoot, p2)) {
        diagnostics.ignoredFiles += 1;
        continue;
      }
      const st2 = await safeLstat(p2);
      if (!st2) continue;
      if (st2.isSymbolicLink()) {
        diagnostics.symlinksSkipped += 1;
        continue;
      }
      if (st2.isFile()) {
        const m = SESSION_JSONL.exec(name);
        if (m && isSafeId(m[1]) && !AGENT_JSONL.test(name)) {
          await addFile(p2, st2, 'main', proj, m[1], null, null);
        } else {
          diagnostics.ignoredFiles += 1;
        }
        continue;
      }
      if (!st2.isDirectory() || !isSafeId(name) || maxDepth < 3) {
        diagnostics.ignoredFiles += 1;
        continue;
      }

      // depth 3: <session>/subagents
      const subDir = join(p2, 'subagents');
      const sst = await safeLstat(subDir, true);
      if (!sst) continue;
      if (sst.isSymbolicLink()) {
        diagnostics.symlinksSkipped += 1;
        continue;
      }
      if (!sst.isDirectory() || maxDepth < 4) {
        diagnostics.ignoredFiles += 1;
        continue;
      }
      const names = (await ls(subDir)) ?? [];
      const nameSet = new Set(names);
      for (const fname of names) {
        const p4 = join(subDir, fname);
        if (fname.endsWith('.meta.json') && AGENT_JSONL.test(fname.replace(/\.meta\.json$/, '.jsonl'))) continue;
        const st4 = await safeLstat(p4);
        if (!st4) continue;
        if (st4.isSymbolicLink()) {
          diagnostics.symlinksSkipped += 1;
          continue;
        }
        const am = AGENT_JSONL.exec(fname);
        if (!st4.isFile() || !am || !isSafeId(am[1]) || !isInsideRoot(realRoot, p4)) {
          diagnostics.ignoredFiles += 1;
          continue;
        }
        const metaName = `agent-${am[1]}.meta.json`;
        let metaPath: string | null = null;
        if (nameSet.has(metaName)) {
          const mp = join(subDir, metaName);
          const mst = await safeLstat(mp);
          if (mst && mst.isFile() && !mst.isSymbolicLink()) metaPath = mp;
          else if (mst?.isSymbolicLink()) diagnostics.symlinksSkipped += 1;
        }
        await addFile(p4, st4, 'agent', proj, name, am[1], metaPath);
      }
    }
  }
  sources.sort((a, b) => (a.localPath < b.localPath ? -1 : 1));
  return { sources, diagnostics };
}
