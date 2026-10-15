import { COST_REASON, formatMicroUsd, type CostSummary, type RateSchedule, type TokenTotals } from '@orbit/core';

export const PROCESSED_SQL =
  '(r.uncached_input + r.output + r.cache_read + r.cache_write_5m + r.cache_write_1h + r.unsplit_cache_write)';

/** Aggregate select list over alias `r`. */
export const AGG_SQL = `
  COUNT(*) AS n,
  COALESCE(SUM(r.uncached_input), 0) AS ui,
  COALESCE(SUM(r.output), 0) AS o,
  COALESCE(SUM(r.cache_read), 0) AS cr,
  COALESCE(SUM(r.cache_write_5m), 0) AS c5,
  COALESCE(SUM(r.cache_write_1h), 0) AS c1,
  COALESCE(SUM(r.unsplit_cache_write), 0) AS us,
  COALESCE(SUM(r.micro_usd), 0) AS usd,
  COALESCE(SUM(CASE WHEN r.micro_usd IS NULL THEN 1 ELSE 0 END), 0) AS unpriced,
  COALESCE(SUM(CASE WHEN r.price_quality = 'estimated_fallback' THEN 1 ELSE 0 END), 0) AS fb,
  COALESCE(SUM(CASE WHEN r.micro_usd IS NULL THEN ${PROCESSED_SQL} ELSE 0 END), 0) AS unpriced_tok`;

/** Same select list over rollup-shaped rows (alias `x`, see db/rollup.ts). */
export const AGG_X = `
  COALESCE(SUM(x.n), 0) AS n,
  COALESCE(SUM(x.ui), 0) AS ui,
  COALESCE(SUM(x.o), 0) AS o,
  COALESCE(SUM(x.cr), 0) AS cr,
  COALESCE(SUM(x.c5), 0) AS c5,
  COALESCE(SUM(x.c1), 0) AS c1,
  COALESCE(SUM(x.us), 0) AS us,
  COALESCE(SUM(x.usd), 0) AS usd,
  COALESCE(SUM(x.unpriced), 0) AS unpriced,
  COALESCE(SUM(x.fb), 0) AS fb,
  COALESCE(SUM(x.unpriced_tok), 0) AS unpriced_tok`;

export const PROCESSED_X = '(x.ui + x.o + x.cr + x.c5 + x.c1 + x.us)';

export interface Agg {
  n: number;
  ui: number;
  o: number;
  cr: number;
  c5: number;
  c1: number;
  us: number;
  usd: number;
  unpriced: number;
  fb: number;
  unpriced_tok: number;
}

export const EMPTY_AGG: Agg = { n: 0, ui: 0, o: 0, cr: 0, c5: 0, c1: 0, us: 0, usd: 0, unpriced: 0, fb: 0, unpriced_tok: 0 };

export function tokensOf(a: Agg): TokenTotals {
  return {
    uncachedInput: a.ui,
    output: a.o,
    cacheRead: a.cr,
    cacheWrite5m: a.c5,
    cacheWrite1h: a.c1,
    unsplitCacheWrite: a.us,
    processed: processedOf(a),
  };
}

export function processedOf(a: Agg): number {
  return a.ui + a.o + a.cr + a.c5 + a.c1 + a.us;
}

export function usdOf(a: Agg): string {
  return formatMicroUsd(BigInt(a.usd));
}

export function costSummaryOf(a: Agg, schedule: RateSchedule, unpricedModels: string[]): CostSummary {
  const priced = a.n - a.unpriced;
  const allTokens = processedOf(a);
  const pricedTokens = allTokens - a.unpriced_tok;
  return {
    usdDecimal: usdOf(a),
    quality: 'estimated',
    reason: COST_REASON,
    rateScheduleVersion: schedule.version,
    pricedRequestCount: priced,
    fallbackPricedRequestCount: a.fb,
    unpricedRequestCount: a.unpriced,
    unpricedTokens: a.unpriced_tok,
    unpricedModels,
    requestCoverage: a.n === 0 ? 1 : priced / a.n,
    tokenCoverage: allTokens === 0 ? 1 : pricedTokens / allTokens,
  };
}

export function splitModels(s: string | null): string[] {
  return s ? s.split(',').filter((x) => x.length > 0).sort() : [];
}
