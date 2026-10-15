import { createHash } from 'node:crypto';
import { stripInvisible } from '@orbit/core/node';

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Opaque project id from a cwd (never reversible from the DTO). */
export function projectIdFromCwd(cwd: string): string {
  return 'p_' + sha256Hex(cwd).slice(0, 12);
}

/** Storage form of the encoded project folder name (an encoded absolute cwd): sha256 hex, never the name itself. */
export function hashProjectDir(projectDirName: string): string {
  return sha256Hex(projectDirName);
}

/** Fallback project id for sessions without a cwd; input is the stored {@link hashProjectDir} value. */
export function projectIdFromDir(projectDirHash: string): string {
  return 'p_' + sha256Hex('dir:' + projectDirHash).slice(0, 12);
}

export function shortCodeOf(projectId: string): string {
  return projectId.slice(2, 6);
}

/** Sanitized basename of a cwd (controls, bidi overrides and zero-width characters removed), max 80 chars. Kept as text; the UI escapes it. */
export function labelFromCwd(cwd: string): string {
  const parts = cwd.split(/[\\/]+/).filter((p) => p.length > 0);
  const base = stripInvisible(parts[parts.length - 1] ?? '').trim();
  return base.slice(0, 80);
}

export function fallbackLabel(projectId: string): string {
  return 'project-' + shortCodeOf(projectId);
}

/** Opaque agent id, unique across sessions. */
export function agentKey(sessionId: string, agentId: string): string {
  return 'a_' + sha256Hex(`${sessionId}\0${agentId}`).slice(0, 12);
}

export function sanitizeAlias(v: string): string {
  return stripInvisible(v).trim().slice(0, 60);
}
