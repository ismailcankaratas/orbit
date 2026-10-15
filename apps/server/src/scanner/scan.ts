import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { relative } from 'node:path';
import {
  computeDedupeKey,
  discoverSources,
  DiscoveryError,
  linkAgents,
  mergeSnapshot,
  namespaceFor,
  openRegularFile,
  parseJsonlLine,
  readAgentMeta,
  readJsonlIncrement,
  type DedupeContext,
  type DiscoveredSource,
  type DiscoveryDiagnostics,
  type ParentTaskRef,
} from '@orbit/core/node';
import { stripInvisible } from '@orbit/core/node';
import type { AssistantSnapshot, EnvelopeInfo, RateSchedule, UniqueRequest } from '@orbit/core';
import type { Store } from '../db/index.js';
import { refreshRollup } from '../db/rollup.js';
import { agentKey, fallbackLabel, hashProjectDir, labelFromCwd, projectIdFromCwd, projectIdFromDir, shortCodeOf } from './identity.js';
import { priceRow, repriceIfNeeded, toMicroNumber } from './pricing.js';

export type ScanErrorCode = 'SOURCE_NOT_FOUND' | 'PERMISSION_DENIED' | 'INTERNAL';

export class ScanError extends Error {
  constructor(readonly code: ScanErrorCode) {
    super(code);
    this.name = 'ScanError';
  }
}

export interface ScanStats {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  filesScanned: number;
  filesSkipped: number;
  bytesRead: number;
  discovery: DiscoveryDiagnostics;
}

export interface ScanOptions {
  store: Store;
  root: string;
  archive: boolean;
  schedule: RateSchedule;
  now?: () => number;
  onProgress?: (done: number, total: number) => void;
  /** Test hooks. */
  hooks?: { afterDiscovery?: (sources: readonly DiscoveredSource[]) => Promise<void> | void };
}

export interface ScanResult {
  changed: boolean;
  changedProjects: string[];
  stats: ScanStats;
}

interface SourceRow {
  id: string;
  kind: 'main' | 'agent';
  rel_path: string;
  session_id: string;
  agent_id: string | null;
  head_len: number;
  head_hash: string | null;
  dev: number | null;
  ino: number | null;
  size: number;
  mtime_ms: number;
  cursor_offset: number;
  present: number;
  cwd_hash: string | null;
  cwd_label: string | null;
  first_ms: number | null;
  last_ms: number | null;
}

interface RequestRow {
  dedupe_key: string;
  dedupe_quality: 'exact' | 'uncertain';
  source_kind: 'main' | 'agent';
  source_file_id: string;
  session_id: string;
  agent_id: string | null;
  model: string | null;
  ts_ms: number | null;
  ts_derived: number;
  first_seen_ms: number | null;
  uncached_input: number;
  output: number;
  cache_read: number;
  cache_write_5m: number;
  cache_write_1h: number;
  unsplit_cache_write: number;
  snapshot_count: number;
  stop_reason: string | null;
}

const CHUNK_BYTES = 16 * 1024 * 1024;
const HEAD_BYTES = 4096;
const yieldLoop = (): Promise<void> => new Promise((r) => setImmediate(r));
const isoOrNull = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());
const msOrNull = (iso: string | null): number | null => {
  if (iso === null) return null;
  const n = Date.parse(iso);
  return Number.isNaN(n) ? null : n;
};

function rowToRequest(r: RequestRow): UniqueRequest {
  return {
    dedupeKey: r.dedupe_key,
    dedupeQuality: r.dedupe_quality,
    sourceKind: r.source_kind,
    sourceFileId: r.source_file_id,
    sessionId: r.session_id,
    agentId: r.agent_id,
    messageId: null,
    requestId: null,
    model: r.model,
    timestamp: r.ts_derived ? null : isoOrNull(r.ts_ms),
    firstSeenAt: isoOrNull(r.first_seen_ms),
    usage: {
      uncachedInput: r.uncached_input,
      output: r.output,
      cacheRead: r.cache_read,
      cacheWrite5m: r.cache_write_5m,
      cacheWrite1h: r.cache_write_1h,
      unsplitCacheWrite: r.unsplit_cache_write,
    },
    snapshotCount: r.snapshot_count,
    stopReason: r.stop_reason,
    tasks: [],
  };
}

function usageEqual(a: UniqueRequest['usage'], b: UniqueRequest['usage']): boolean {
  return (
    a.uncachedInput === b.uncachedInput &&
    a.output === b.output &&
    a.cacheRead === b.cacheRead &&
    a.cacheWrite5m === b.cacheWrite5m &&
    a.cacheWrite1h === b.cacheWrite1h &&
    a.unsplitCacheWrite === b.unsplitCacheWrite
  );
}

const UPSERT_REQUEST = `
INSERT INTO requests (dedupe_key, dedupe_quality, source_file_id, source_kind, session_id, agent_id, model, ts_ms, ts_derived,
  first_seen_ms, uncached_input, output, cache_read, cache_write_5m, cache_write_1h, unsplit_cache_write, snapshot_count,
  stop_reason, micro_usd, price_quality, rate_model_id, rate_version, source_present)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
ON CONFLICT(dedupe_key) DO UPDATE SET
  model = excluded.model, ts_ms = excluded.ts_ms, ts_derived = 0, first_seen_ms = excluded.first_seen_ms,
  uncached_input = excluded.uncached_input, output = excluded.output, cache_read = excluded.cache_read,
  cache_write_5m = excluded.cache_write_5m, cache_write_1h = excluded.cache_write_1h,
  unsplit_cache_write = excluded.unsplit_cache_write, snapshot_count = excluded.snapshot_count,
  stop_reason = excluded.stop_reason, micro_usd = excluded.micro_usd, price_quality = excluded.price_quality,
  rate_model_id = excluded.rate_model_id, rate_version = excluded.rate_version, source_present = 1`;

/** sha256 of the first `len` bytes of a file (null if unreadable / changed). Used only to confirm renames by inode. */
async function headHash(path: string, expect: { dev: number; ino: number }, len: number): Promise<string | null> {
  if (len <= 0) return null;
  try {
    const fh = await openRegularFile(path, expect);
    try {
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fh.read(buf, 0, len, 0);
      return bytesRead === len ? createHash('sha256').update(buf).digest('hex') : null;
    } finally {
      await fh.close().catch(() => undefined);
    }
  } catch {
    return null;
  }
}

function deleteFileChildren(store: Store, id: string): void {
  store.run('DELETE FROM requests WHERE source_file_id = ?', id);
  store.run('DELETE FROM parse_warnings WHERE source_file_id = ?', id);
  store.run('DELETE FROM task_refs WHERE source_file_id = ?', id);
}

interface FileOutcome {
  skipped: boolean;
  failed?: boolean;
  mutations: number;
  bytes: number;
  sessionId: string;
}

async function processFile(
  store: Store,
  schedule: RateSchedule,
  realRoot: string,
  s: DiscoveredSource,
  prev: SourceRow | undefined,
  nowMs: number,
): Promise<FileOutcome> {
  const id = s.sourceFileId;
  const aKey = s.kind === 'agent' && s.agentId ? agentKey(s.sessionId, s.agentId) : null;
  let mutations = 0;
  let start = 0;
  let reset = false;

  const rel = relative(realRoot, s.localPath);
  const projectDirHash = hashProjectDir(s.projectDirName);
  if (prev) {
    // A moved file keeps its id (see runScan); a changed session/agent/kind means its stored rows are mis-attributed.
    const identityChanged = prev.session_id !== s.sessionId || prev.kind !== s.kind || prev.agent_id !== s.agentId;
    if (prev.dev !== s.dev || prev.ino !== s.ino || s.size < prev.cursor_offset || identityChanged) reset = true;
    else if (prev.present === 1 && prev.size === s.size && prev.mtime_ms === s.mtimeMs) {
      if (prev.rel_path !== rel) store.run('UPDATE source_files SET rel_path = ?, project_dir = ? WHERE id = ?', rel, projectDirHash, id);
      return { skipped: true, mutations: 0, bytes: 0, sessionId: s.sessionId };
    } else start = prev.cursor_offset;
  }

  store.tx(() => {
    if (!prev) {
      store.run(
        `INSERT INTO source_files (id, kind, rel_path, project_dir, session_id, agent_id, dev, ino, size, mtime_ms, cursor_offset, present)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 1)`,
        id, s.kind, rel, projectDirHash, s.sessionId, s.agentId, s.dev, s.ino,
      );
    } else if (reset) {
      deleteFileChildren(store, id);
      store.run('DELETE FROM agents WHERE source_file_id = ? AND id IS NOT ?', id, aKey);
      store.run(
        `UPDATE source_files SET kind = ?, rel_path = ?, project_dir = ?, session_id = ?, agent_id = ?, dev = ?, ino = ?, size = 0,
           mtime_ms = 0, cursor_offset = 0, first_ms = NULL, last_ms = NULL, cwd_hash = NULL, cwd_label = NULL WHERE id = ?`,
        s.kind, rel, projectDirHash, s.sessionId, s.agentId, s.dev, s.ino, id,
      );
      mutations += 1;
    } else if (prev.rel_path !== rel) {
      store.run('UPDATE source_files SET rel_path = ?, project_dir = ? WHERE id = ?', rel, projectDirHash, id);
    }
  });

  let metaToolUseId: string | null = null;
  let metaRole: string | null = null;
  let metaDepth: number | null = null;
  if (aKey && s.agentId) {
    const meta = s.metaLocalPath ? await readAgentMeta(s.metaLocalPath) : null;
    metaToolUseId = meta?.toolUseId ?? null;
    metaRole = meta?.agentType ?? null;
    metaDepth = meta?.spawnDepth ?? null;
    store.run(
      `INSERT INTO agents (id, source_file_id, session_id, meta_tool_use_id, meta_role, meta_depth, present)
       VALUES (?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(id) DO UPDATE SET source_file_id = excluded.source_file_id, session_id = excluded.session_id,
         meta_tool_use_id = excluded.meta_tool_use_id, meta_role = excluded.meta_role, meta_depth = excluded.meta_depth, present = 1`,
      aKey, id, s.sessionId, metaToolUseId, metaRole, metaDepth,
    );
  }

  const dctx: DedupeContext = { sourceKind: s.kind, sourceFileId: id, namespace: namespaceFor(s.kind, id) };
  let minTs: number | null = reset ? null : prev?.first_ms ?? null;
  let maxTs: number | null = reset ? null : prev?.last_ms ?? null;
  let projectId: string | null = reset ? null : prev?.cwd_hash ?? null;
  let projectLabel: string | null = reset ? null : prev?.cwd_label ?? null;

  const track = (rec: EnvelopeInfo): void => {
    const t = msOrNull(rec.timestamp);
    if (t !== null) {
      if (minTs === null || t < minTs) minTs = t;
      if (maxTs === null || t > maxTs) maxTs = t;
    }
    if (s.kind === 'main' && projectId === null && rec.cwd) {
      projectId = projectIdFromCwd(rec.cwd);
      projectLabel = labelFromCwd(rec.cwd);
    }
  };

  let offset = start;
  let restarted = reset;
  let bytes = 0;
  let finalIdentity = { dev: s.dev, ino: s.ino, size: s.size, mtimeMs: s.mtimeMs };
  try {
    for (;;) {
      const inc = await readJsonlIncrement(s.localPath, { fromOffset: offset, maxBytes: CHUNK_BYTES, expectIdentity: { dev: s.dev, ino: s.ino } });
      finalIdentity = inc.fileIdentity;
      if (inc.truncated) {
        if (restarted) break;
        restarted = true;
        offset = 0;
        minTs = maxTs = null;
        projectId = projectLabel = null;
        store.tx(() => {
          deleteFileChildren(store, id);
          store.run('UPDATE source_files SET cursor_offset = 0, size = 0, mtime_ms = 0 WHERE id = ?', id);
        });
        mutations += 1;
        continue;
      }
      const warnCounts = new Map<string, number>();
      store.tx(() => {
        const touched = new Map<string, UniqueRequest>();
        const before = new Map<string, UniqueRequest | null>();
        for (const line of inc.lines) {
          const { result, warnings } = parseJsonlLine(line);
          for (const w of warnings) warnCounts.set(w.code, (warnCounts.get(w.code) ?? 0) + 1);
          if (result.kind === 'envelope') {
            track(result.record);
          } else if (result.kind === 'assistant_usage') {
            const snap: AssistantSnapshot = result.record;
            track(snap);
            const { key } = computeDedupeKey(snap, dctx);
            let ex = touched.get(key);
            if (!ex) {
              const row = store.get<RequestRow>('SELECT * FROM requests WHERE dedupe_key = ?', key);
              ex = row ? rowToRequest(row) : undefined;
              before.set(key, ex ?? null);
            }
            touched.set(key, mergeSnapshot(ex, snap, dctx));
            for (const t of snap.tasks) {
              store.run(
                `INSERT INTO task_refs (tool_use_id, session_id, source_file_id, parent_agent_id, tool_name, role)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(session_id, tool_use_id) DO UPDATE SET role = COALESCE(excluded.role, task_refs.role)`,
                t.toolUseId, s.sessionId, id, aKey, t.toolName, t.role,
              );
            }
          }
        }
        for (const [key, req] of touched) {
          const prevReq = before.get(key) ?? null;
          const tsMs = msOrNull(req.timestamp);
          const p = priceRow(
            {
              dedupe_key: key,
              model: req.model,
              ts_ms: tsMs,
              uncached_input: req.usage.uncachedInput,
              output: req.usage.output,
              cache_read: req.usage.cacheRead,
              cache_write_5m: req.usage.cacheWrite5m,
              cache_write_1h: req.usage.cacheWrite1h,
              unsplit_cache_write: req.usage.unsplitCacheWrite,
            },
            schedule,
          );
          store.run(
            UPSERT_REQUEST,
            key, req.dedupeQuality, id, s.kind, s.sessionId, aKey, req.model, tsMs, msOrNull(req.firstSeenAt),
            req.usage.uncachedInput, req.usage.output, req.usage.cacheRead, req.usage.cacheWrite5m, req.usage.cacheWrite1h,
            req.usage.unsplitCacheWrite, req.snapshotCount, req.stopReason, toMicroNumber(p.microUsd), p.priceQuality,
            p.rateModelId, schedule.version,
          );
          if (!prevReq || !usageEqual(prevReq.usage, req.usage) || prevReq.model !== req.model || prevReq.timestamp !== req.timestamp) {
            mutations += 1;
          }
        }
        for (const [code, count] of warnCounts) {
          store.run(
            `INSERT INTO parse_warnings (source_file_id, code, count) VALUES (?, ?, ?)
             ON CONFLICT(source_file_id, code) DO UPDATE SET count = count + excluded.count`,
            id, code, count,
          );
        }
        bytes += inc.nextOffset - offset;
        offset = inc.nextOffset;
        store.run(
          'UPDATE source_files SET cursor_offset = ?, size = ?, mtime_ms = ?, dev = ?, ino = ? WHERE id = ?',
          offset, inc.fileIdentity.size, inc.fileIdentity.mtimeMs, inc.fileIdentity.dev, inc.fileIdentity.ino, id,
        );
      });
      if (inc.lines.length === 0 || offset >= inc.fileIdentity.size) break;
      await yieldLoop();
    }
  } catch {
    // File vanished, was swapped, or became unreadable mid-read: leave committed batches in place, count nothing more.
    if (!prev) store.run('DELETE FROM source_files WHERE id = ? AND cursor_offset = 0 AND NOT EXISTS (SELECT 1 FROM requests WHERE source_file_id = ?)', id, id);
    return { skipped: false, failed: true, mutations, bytes, sessionId: s.sessionId };
  }

  const hl = Math.min(HEAD_BYTES, finalIdentity.size);
  const hh = await headHash(s.localPath, { dev: s.dev, ino: s.ino }, hl);
  store.tx(() => {
    const flipped = store.run('UPDATE requests SET source_present = 1 WHERE source_file_id = ? AND source_present = 0', id);
    if (flipped > 0) mutations += flipped;
    store.run(
      `UPDATE source_files SET cursor_offset = ?, size = ?, mtime_ms = ?, dev = ?, ino = ?, present = 1, last_scanned_at = ?,
         first_ms = ?, last_ms = ?, cwd_hash = ?, cwd_label = ?, head_len = ?, head_hash = ? WHERE id = ?`,
      offset, finalIdentity.size, finalIdentity.mtimeMs, finalIdentity.dev, finalIdentity.ino, nowMs, minTs, maxTs, projectId,
      projectLabel, hh === null ? 0 : hl, hh, id,
    );
    if (aKey) store.run('UPDATE agents SET first_ms = ?, last_ms = ?, present = 1 WHERE id = ?', minTs, maxTs, aKey);
  });
  if (!prev) mutations += 1;
  return { skipped: false, mutations, bytes, sessionId: s.sessionId };
}

interface DerivedFile {
  kind: string;
  project_dir: string;
  session_id: string;
  cwd_hash: string | null;
  cwd_label: string | null;
  first_ms: number | null;
  last_ms: number | null;
  present: number;
}

/** Recompute projects, sessions, request->project mapping, derived timestamps and agent links from stored rows. */
export function rebuildDerived(store: Store): void {
  store.tx(() => {
    const files = store.all<DerivedFile>(
      'SELECT kind, project_dir, session_id, cwd_hash, cwd_label, first_ms, last_ms, present FROM source_files',
    );
    const sessions = new Map<
      string,
      { projectId: string; label: string; first: number | null; last: number | null; present: number }
    >();
    const grouped = new Map<string, DerivedFile[]>();
    for (const f of files) {
      const g = grouped.get(f.session_id);
      if (g) g.push(f);
      else grouped.set(f.session_id, [f]);
    }
    const projects = new Map<string, string>();
    for (const [sid, fs] of grouped) {
      const main = fs.find((f) => f.kind === 'main' && f.cwd_hash) ?? fs.find((f) => f.cwd_hash);
      const projectId = main?.cwd_hash ?? projectIdFromDir((fs[0] as DerivedFile).project_dir);
      const cleaned = main?.cwd_label ? stripInvisible(main.cwd_label).trim() : '';
      const label = cleaned.length > 0 ? cleaned : fallbackLabel(projectId);
      let first: number | null = null;
      let last: number | null = null;
      let present = 0;
      for (const f of fs) {
        if (f.first_ms !== null && (first === null || f.first_ms < first)) first = f.first_ms;
        if (f.last_ms !== null && (last === null || f.last_ms > last)) last = f.last_ms;
        if (f.present === 1) present = 1;
      }
      sessions.set(sid, { projectId, label, first, last, present });
      if (!projects.has(projectId) || (main && main.cwd_label)) projects.set(projectId, label);
    }

    for (const [pid, label] of projects) {
      store.run(
        `INSERT INTO projects (id, label, short_code) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET label = excluded.label`,
        pid, label, shortCodeOf(pid),
      );
    }
    for (const row of store.all<{ id: string }>('SELECT id FROM projects')) {
      if (!projects.has(row.id)) store.run('DELETE FROM projects WHERE id = ?', row.id);
    }
    for (const [sid, v] of sessions) {
      store.run(
        `INSERT INTO sessions (id, project_id, first_ms, last_ms, present) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET project_id = excluded.project_id, first_ms = excluded.first_ms,
           last_ms = excluded.last_ms, present = excluded.present`,
        sid, v.projectId, v.first, v.last, v.present,
      );
    }
    for (const row of store.all<{ id: string }>('SELECT id FROM sessions')) {
      if (!sessions.has(row.id)) store.run('DELETE FROM sessions WHERE id = ?', row.id);
    }

    store.run(
      `UPDATE requests SET project_id = s.project_id FROM sessions s
       WHERE s.id = requests.session_id AND requests.project_id IS NOT s.project_id`,
    );
    // Requests that carry no timestamp are placed at their session's first observed time (derived, flagged).
    store.run(
      `UPDATE requests SET ts_ms = s.first_ms, ts_derived = 1 FROM sessions s
       WHERE s.id = requests.session_id AND requests.ts_ms IS NULL AND s.first_ms IS NOT NULL`,
    );

    // Agent linking over all refs + agents.
    const agents = store.all<{
      id: string;
      session_id: string;
      meta_tool_use_id: string | null;
      meta_role: string | null;
      meta_depth: number | null;
    }>('SELECT id, session_id, meta_tool_use_id, meta_role, meta_depth FROM agents ORDER BY id');
    const refs = store.all<{
      tool_use_id: string;
      session_id: string;
      parent_agent_id: string | null;
      tool_name: string;
      role: string | null;
    }>('SELECT tool_use_id, session_id, parent_agent_id, tool_name, role FROM task_refs ORDER BY session_id, tool_use_id');
    const links = linkAgents(
      refs.map<ParentTaskRef>((r) => ({
        toolUseId: r.tool_use_id,
        toolName: r.tool_name,
        role: r.role,
        sessionId: r.session_id,
        parentAgentId: r.parent_agent_id,
      })),
      agents.map((a) => ({
        agentId: a.id,
        sessionId: a.session_id,
        meta: { agentId: null, agentType: a.meta_role, toolUseId: a.meta_tool_use_id, spawnDepth: a.meta_depth },
        underSessionDir: true,
      })),
    );
    agents.forEach((a, i) => {
      const l = links[i];
      if (!l) return;
      store.run(
        `UPDATE agents SET parent_agent_id = ?, role = ?, depth = ?, confidence = ?, reason = ?,
           project_id = (SELECT project_id FROM sessions WHERE id = agents.session_id) WHERE id = ?`,
        l.parentAgentId, l.role, l.depth, l.confidence, l.reason, a.id,
      );
    });
  });
}

/**
 * A source file that vanished from one path and appeared at another with the same (dev, ino) AND the same leading
 * bytes is a rename/move: keep its stored id so its dedupe namespace, cursor and rows carry over (no double count,
 * no loss). Inode reuse by an unrelated file fails the head-hash check. Cross-filesystem copies change the inode and
 * are indistinguishable from a new file (documented limitation).
 */
async function remapMovedFiles(sources: DiscoveredSource[], prevRows: Map<string, SourceRow>): Promise<void> {
  const present = new Set(sources.map((x) => x.sourceFileId));
  const vanished = new Map<string, SourceRow[]>();
  for (const r of prevRows.values()) {
    if (present.has(r.id) || r.dev === null || r.ino === null || r.head_len <= 0 || !r.head_hash) continue;
    const k = `${r.dev}:${r.ino}`;
    const arr = vanished.get(k);
    if (arr) arr.push(r);
    else vanished.set(k, [r]);
  }
  if (vanished.size === 0) return;
  for (const src of sources) {
    if (prevRows.has(src.sourceFileId)) continue;
    const cands = vanished.get(`${src.dev}:${src.ino}`);
    if (!cands) continue;
    for (const c of cands) {
      if (src.size < c.head_len) continue;
      if ((await headHash(src.localPath, { dev: src.dev, ino: src.ino }, c.head_len)) === c.head_hash) {
        src.sourceFileId = c.id;
        cands.splice(cands.indexOf(c), 1);
        break;
      }
    }
  }
}

export async function runScan(opts: ScanOptions): Promise<ScanResult> {
  const { store, root, archive, schedule } = opts;
  const now = opts.now ?? Date.now;
  const started = now();
  repriceIfNeeded(store, schedule);

  let discovery;
  let realRoot: string;
  try {
    discovery = await discoverSources(root);
    realRoot = await realpath(root);
  } catch (e) {
    if (e instanceof DiscoveryError) throw new ScanError(e.code);
    throw new ScanError('INTERNAL');
  }
  const { sources, diagnostics } = discovery;
  await opts.hooks?.afterDiscovery?.(sources);
  const prevRows = new Map(store.all<SourceRow>('SELECT * FROM source_files').map((r) => [r.id, r]));
  await remapMovedFiles(sources, prevRows);

  let mutations = 0;
  let scanned = 0;
  let skipped = 0;
  let bytes = 0;
  let failed = 0;
  const touchedSessions = new Set<string>();
  opts.onProgress?.(0, sources.length);
  let done = 0;
  for (const s of sources) {
    try {
      const out = await processFile(store, schedule, realRoot, s, prevRows.get(s.sourceFileId), now());
      if (out.skipped) skipped += 1;
      else if (out.failed) failed += 1;
      else scanned += 1;
      if (out.mutations > 0) {
        mutations += out.mutations;
        touchedSessions.add(out.sessionId);
      }
      bytes += out.bytes;
    } catch {
      failed += 1;
    }
    done += 1;
    opts.onProgress?.(done, sources.length);
    if (done % 25 === 0) await yieldLoop();
  }

  // Vanished files. Do not purge when discovery was incomplete (unreadable entries).
  const seen = new Set(sources.map((s) => s.sourceFileId));
  store.tx(() => {
    for (const prev of prevRows.values()) {
      if (seen.has(prev.id)) continue;
      if (archive) {
        if (prev.present === 1) {
          store.run('UPDATE source_files SET present = 0 WHERE id = ?', prev.id);
          store.run('UPDATE requests SET source_present = 0 WHERE source_file_id = ?', prev.id);
          store.run('UPDATE agents SET present = 0 WHERE source_file_id = ?', prev.id);
          mutations += 1;
          touchedSessions.add(prev.session_id);
        }
      } else if (diagnostics.unreadable === 0) {
        store.run('DELETE FROM source_files WHERE id = ?', prev.id);
        mutations += 1;
        touchedSessions.add(prev.session_id);
      }
    }
  });

  const needsDerived = mutations > 0 || store.getMeta('derived_built') !== '1';
  let changedProjects: string[] = [];
  if (needsDerived) {
    const projectsBefore = new Map(store.all<{ id: string; project_id: string }>('SELECT id, project_id FROM sessions').map((r) => [r.id, r.project_id]));
    rebuildDerived(store);
    const ids = new Set<string>();
    for (const sid of touchedSessions) {
      const p = store.get<{ project_id: string }>('SELECT project_id FROM sessions WHERE id = ?', sid)?.project_id;
      if (p) ids.add(p);
      const old = projectsBefore.get(sid);
      if (old) ids.add(old);
    }
    changedProjects = [...ids].sort();
    store.setMeta('derived_built', '1');
  }
  refreshRollup(store);

  const finished = now();
  const stats: ScanStats = {
    startedAt: new Date(started).toISOString(),
    finishedAt: new Date(finished).toISOString(),
    durationMs: finished - started,
    filesScanned: scanned,
    filesSkipped: skipped,
    bytesRead: bytes,
    discovery: { ...diagnostics, unreadable: diagnostics.unreadable + failed },
  };
  store.setMeta('last_scan', JSON.stringify(stats));
  store.chmodFiles();
  return { changed: mutations > 0, changedProjects, stats };
}
