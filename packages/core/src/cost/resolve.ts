import type { RateEntry, RateSchedule } from '../schemas/types.js';

/**
 * Normalize a model id: trim, lowercase, strip trailing `[1m]` context marker and
 * a trailing `-YYYYMMDD` snapshot suffix. Platform prefixes (`anthropic.`,
 * `us.anthropic.`, vertex `@` snapshots) are deliberately NOT stripped: partner
 * platforms bill differently, so they stay unknown.
 */
export function normalizeModelId(id: string): string {
  let s = id.trim().toLowerCase();
  s = s.replace(/\[1m\]$/, '');
  s = s.replace(/-\d{8}$/, '');
  return s;
}

export type ResolveResult =
  | { ok: true; entry: RateEntry }
  | { ok: false; reason: 'unknown_model' | 'missing_model' | 'no_rate_for_time' };

function matches(entry: RateEntry, norm: string): boolean {
  if (normalizeModelId(entry.modelId) === norm) return true;
  return entry.aliases.some((a) => normalizeModelId(a) === norm);
}

/**
 * Pick the entry for a model at an event time. user_override wins over official.
 * `atIso === null` (no timestamp): use the latest interval (greatest effectiveFrom,
 * overrides first) and still price; callers should not treat it as an error.
 */
export function resolveRate(
  schedule: RateSchedule,
  modelId: string | null,
  atIso: string | null,
): ResolveResult {
  if (modelId === null || modelId.trim() === '') return { ok: false, reason: 'missing_model' };
  const norm = normalizeModelId(modelId);
  const candidates = schedule.entries.filter((e) => matches(e, norm));
  if (candidates.length === 0) return { ok: false, reason: 'unknown_model' };

  let pool: RateEntry[];
  const t = atIso === null ? NaN : Date.parse(atIso);
  if (atIso === null || Number.isNaN(t)) {
    pool = candidates;
  } else {
    pool = candidates.filter(
      (e) => Date.parse(e.effectiveFrom) <= t && (e.effectiveTo === null || t < Date.parse(e.effectiveTo)),
    );
    if (pool.length === 0) return { ok: false, reason: 'no_rate_for_time' };
  }
  const sorted = [...pool].sort((a, b) => {
    if (a.source !== b.source) return a.source === 'user_override' ? -1 : 1;
    return Date.parse(b.effectiveFrom) - Date.parse(a.effectiveFrom);
  });
  return { ok: true, entry: sorted[0] as RateEntry };
}
