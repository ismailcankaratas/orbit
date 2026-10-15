import { createHash } from 'node:crypto';
import type { AssistantSnapshot, SourceKind, TaskInvocationRef, UniqueRequest } from '../schemas/types.js';

export interface DedupeContext {
  sourceKind: SourceKind;
  sourceFileId: string;
  /** `main:<sourceFileId>` or `agent:<sourceFileId>`; requests never merge across namespaces. */
  namespace: string;
}

export function namespaceFor(sourceKind: SourceKind, sourceFileId: string): string {
  return `${sourceKind}:${sourceFileId}`;
}

function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function computeDedupeKey(
  snap: Pick<AssistantSnapshot, 'messageId' | 'requestId' | 'uuid' | 'lineOffset'>,
  ctx: DedupeContext,
): { key: string; quality: 'exact' | 'uncertain' } {
  if (snap.messageId) return { key: sha(`${ctx.namespace}\0${snap.messageId}`), quality: 'exact' };
  if (snap.requestId) return { key: sha(`${ctx.namespace}\0req:${snap.requestId}`), quality: 'uncertain' };
  if (snap.uuid) return { key: sha(`${ctx.namespace}\0uuid:${snap.uuid}`), quality: 'uncertain' };
  return { key: sha(`${ctx.namespace}\0line:${ctx.sourceFileId}:${snap.lineOffset}`), quality: 'uncertain' };
}

/** Internal: line offset of the selected final snapshot, for tie-breaking on later merges. */
const finalOffsets = new WeakMap<UniqueRequest, number>();

function tsMs(ts: string | null): number {
  return ts === null ? Number.NEGATIVE_INFINITY : Date.parse(ts);
}

function unionTasks(a: TaskInvocationRef[], b: TaskInvocationRef[]): TaskInvocationRef[] {
  const map = new Map<string, TaskInvocationRef>();
  for (const t of [...a, ...b]) {
    const prev = map.get(t.toolUseId);
    if (!prev) map.set(t.toolUseId, { ...t });
    else if (prev.role === null && t.role !== null) map.set(t.toolUseId, { ...prev, role: t.role });
  }
  return [...map.values()];
}

/** True if `snap` should replace the currently selected final snapshot. */
function beats(snap: AssistantSnapshot, cur: { output: number; ts: string | null; offset: number }): boolean {
  if (snap.usage.output !== cur.output) return snap.usage.output > cur.output;
  const a = tsMs(snap.timestamp);
  const b = tsMs(cur.ts);
  if (a !== b) return a > b;
  return snap.lineOffset >= cur.offset;
}

/** Merge one snapshot into an existing request (or start a new one). Pure: returns a new object. */
export function mergeSnapshot(
  existing: UniqueRequest | undefined,
  snap: AssistantSnapshot,
  ctx: DedupeContext,
): UniqueRequest {
  if (!existing) {
    const { key, quality } = computeDedupeKey(snap, ctx);
    const req: UniqueRequest = {
      dedupeKey: key,
      dedupeQuality: quality,
      sourceKind: ctx.sourceKind,
      sourceFileId: ctx.sourceFileId,
      sessionId: snap.sessionId,
      agentId: snap.agentId,
      messageId: snap.messageId,
      requestId: snap.requestId,
      model: snap.model,
      timestamp: snap.timestamp,
      firstSeenAt: snap.timestamp,
      usage: { ...snap.usage },
      snapshotCount: 1,
      stopReason: snap.stopReason,
      tasks: unionTasks([], snap.tasks),
    };
    finalOffsets.set(req, snap.lineOffset);
    return req;
  }

  const curOffset = finalOffsets.get(existing) ?? -1;
  const replace = beats(snap, { output: existing.usage.output, ts: existing.timestamp, offset: curOffset });
  const firstSeenAt =
    tsMs(snap.timestamp) < tsMs(existing.firstSeenAt) || existing.firstSeenAt === null
      ? snap.timestamp ?? existing.firstSeenAt
      : existing.firstSeenAt;

  const next: UniqueRequest = {
    ...existing,
    firstSeenAt,
    snapshotCount: existing.snapshotCount + 1,
    tasks: unionTasks(existing.tasks, snap.tasks),
    sessionId: replace ? snap.sessionId ?? existing.sessionId : existing.sessionId ?? snap.sessionId,
    agentId: replace ? snap.agentId ?? existing.agentId : existing.agentId ?? snap.agentId,
    requestId: existing.requestId ?? snap.requestId,
    messageId: existing.messageId ?? snap.messageId,
  };
  if (replace) {
    next.model = snap.model ?? existing.model;
    next.timestamp = snap.timestamp;
    next.usage = { ...snap.usage };
    next.stopReason = snap.stopReason ?? existing.stopReason;
    finalOffsets.set(next, snap.lineOffset);
  } else {
    finalOffsets.set(next, curOffset);
  }
  return next;
}

/** Deduplicate a batch of snapshots from one source file. Order of first appearance is preserved. */
export function dedupeSnapshots(snapshots: readonly AssistantSnapshot[], ctx: DedupeContext): UniqueRequest[] {
  const map = new Map<string, UniqueRequest>();
  for (const snap of snapshots) {
    const { key } = computeDedupeKey(snap, ctx);
    map.set(key, mergeSnapshot(map.get(key), snap, ctx));
  }
  return [...map.values()];
}
