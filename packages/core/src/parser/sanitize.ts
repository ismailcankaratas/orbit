/** Shared allowlist sanitizers. Anything failing validation becomes null (never copied through). */

const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const SLUG = /^[a-z0-9._-]{1,64}$/;
const MODEL_ID = /^[A-Za-z0-9_.:/@+-]{1,128}$/;
const VERSION = /^[A-Za-z0-9._+-]{1,64}$/;

export function isSafeId(v: unknown): v is string {
  return typeof v === 'string' && SAFE_ID.test(v);
}

export function safeId(v: unknown): string | null {
  return isSafeId(v) ? v : null;
}

/** Lowercase then validate as slug /^[a-z0-9._-]{1,64}$/; otherwise null. */
export function sanitizeRoleSlug(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 64) return null;
  const s = v.toLowerCase();
  return SLUG.test(s) ? s : null;
}

export function safeModelId(v: unknown): string | null {
  return typeof v === 'string' && MODEL_ID.test(v) ? v : null;
}

export function safeVersion(v: unknown): string | null {
  return typeof v === 'string' && VERSION.test(v) ? v : null;
}

/** cwd is server-internal; only bound its size and reject control chars. */
export function safeCwd(v: unknown): string | null {
  // eslint-disable-next-line no-control-regex
  return typeof v === 'string' && v.length > 0 && v.length <= 4096 && !/[\u0000-\u001f]/.test(v) ? v : null;
}

export function safeType(v: unknown): string {
  return typeof v === 'string' && SLUG.test(v.toLowerCase()) ? v.toLowerCase() : 'unknown';
}

/**
 * Bidi overrides/isolates (U+202A-202E, U+2066-2069), zero-width and invisible format characters
 * (U+200B-200F, U+2060-2064, U+FEFF) plus C0/C1 controls and line/paragraph separators. Used for display labels
 * so a crafted folder name cannot visually spoof another label.
 */
// eslint-disable-next-line no-control-regex
export const INVISIBLE_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069\u200b-\u200f\u2060-\u2064\ufeff]/g;

export function stripInvisible(v: string): string {
  return v.replace(INVISIBLE_CHARS, '');
}
