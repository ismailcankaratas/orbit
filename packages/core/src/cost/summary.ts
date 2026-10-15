import type { CostSummary, PricedRequest, RateSchedule, TokenUsage } from '../schemas/types.js';
import { formatMicroUsd } from './decimal.js';
import { COST_REASON } from './labels.js';

export function processedTokens(u: TokenUsage): number {
  return u.uncachedInput + u.output + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h + u.unsplitCacheWrite;
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    uncachedInput: a.uncachedInput + b.uncachedInput,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
    unsplitCacheWrite: a.unsplitCacheWrite + b.unsplitCacheWrite,
  };
}

/**
 * Sum priced requests (bigint). Coverage = priced / total; with zero requests
 * (or zero tokens) coverage is defined as 1 with counts of 0 — the UI must show
 * "no data" rather than "100%". `unpricedModels` needs the optional `modelByKey`
 * map (PricedRequest carries no raw model); without it the list is empty.
 */
export function summarizeCosts(
  priced: PricedRequest[],
  usageByKey: Map<string, TokenUsage>,
  schedule: RateSchedule,
  modelByKey?: Map<string, string | null>,
): CostSummary {
  let total = 0n;
  let pricedCount = 0;
  let fallback = 0;
  let unpricedCount = 0;
  let unpricedTokens = 0;
  let pricedTokens = 0;
  const models = new Set<string>();
  for (const p of priced) {
    const tokens = processedTokens(usageByKey.get(p.dedupeKey) ?? ZERO());
    if (p.microUsd === null) {
      unpricedCount++;
      unpricedTokens += tokens;
      const m = modelByKey?.get(p.dedupeKey) ?? p.model;
      models.add(m && m.trim() !== '' ? m : '(missing model)');
    } else {
      total += p.microUsd;
      pricedCount++;
      pricedTokens += tokens;
      if (p.priceQuality === 'estimated_fallback') fallback++;
    }
  }
  const n = priced.length;
  const allTokens = pricedTokens + unpricedTokens;
  return {
    usdDecimal: formatMicroUsd(total),
    quality: 'estimated',
    reason: COST_REASON,
    rateScheduleVersion: schedule.version,
    pricedRequestCount: pricedCount,
    fallbackPricedRequestCount: fallback,
    unpricedRequestCount: unpricedCount,
    unpricedTokens,
    unpricedModels: [...models].sort(),
    requestCoverage: n === 0 ? 1 : pricedCount / n,
    tokenCoverage: allTokens === 0 ? 1 : pricedTokens / allTokens,
  };
}

function ZERO(): TokenUsage {
  return { uncachedInput: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, unsplitCacheWrite: 0 };
}
