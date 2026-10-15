import type { FileHandle } from 'node:fs/promises';
import { openRegularFile } from './readJsonl.js';
import type { AgentMeta } from '../schemas/types.js';
import { safeId, sanitizeRoleSlug } from './sanitize.js';

export const MAX_META_BYTES = 64 * 1024;

const EMPTY: AgentMeta = { agentId: null, agentType: null, toolUseId: null, spawnDepth: null };

/** Parse agent-*.meta.json text. Caller enforces size; invalid input yields all-null meta. */
export function parseAgentMeta(text: string): AgentMeta {
  if (text.length > MAX_META_BYTES) return { ...EMPTY };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ...EMPTY };
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...EMPTY };
  const o = raw as Record<string, unknown>;
  const d = o['spawnDepth'];
  return {
    agentId: safeId(o['agentId']),
    agentType: sanitizeRoleSlug(o['agentType']),
    toolUseId: safeId(o['toolUseId']),
    spawnDepth: typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 64 ? d : null,
  };
}

/** Read a meta file read-only, refusing files over 64 KiB. Returns null if missing/unreadable/oversize. */
export async function readAgentMeta(path: string): Promise<AgentMeta | null> {
  let fh: FileHandle | undefined;
  try {
    fh = await openRegularFile(path);
    const st = await fh.stat();
    if (!st.isFile() || st.size > MAX_META_BYTES) return null;
    const buf = Buffer.alloc(st.size);
    const { bytesRead } = await fh.read(buf, 0, st.size, 0);
    return parseAgentMeta(buf.subarray(0, bytesRead).toString('utf8'));
  } catch {
    return null;
  } finally {
    await fh?.close().catch(() => undefined);
  }
}
