import type { PricedRequest, RateCard, RateSchedule, TokenUsage } from '../schemas/types.js';
import { RATE_SCALE, parseRate, roundHalfUp } from './decimal.js';
import { resolveRate } from './resolve.js';

export interface PriceInput {
  dedupeKey: string;
  model: string | null;
  timestamp: string | null;
  usage: TokenUsage;
}

function promptTokens(u: TokenUsage): number {
  return u.uncachedInput + u.cacheRead + u.cacheWrite5m + u.cacheWrite1h + u.unsplitCacheWrite;
}

/**
 * Price one unique request. Exact bigint math; rounds half up to micro-USD once.
 * The cache-write aggregate is never charged: only 5m, 1h and the residual
 * `unsplitCacheWrite` (priced at the 5m rate, quality 'estimated_fallback').
 * Unknown/unpriceable -> microUsd null (never 0n).
 */
export function priceRequest(req: PriceInput, schedule: RateSchedule): PricedRequest {
  const base = { dedupeKey: req.dedupeKey, model: req.model, rateScheduleVersion: schedule.version };
  const r = resolveRate(schedule, req.model, req.timestamp);
  if (!r.ok) {
    return { ...base, microUsd: null, priceQuality: 'unpriced', rateModelId: null, unpricedReason: r.reason };
  }
  const { entry } = r;
  const u = req.usage;
  let card: RateCard = entry.rates;
  if (entry.longPromptTier && promptTokens(u) > entry.longPromptTier.thresholdTokens) {
    card = entry.longPromptTier.rates;
  }
  const w5 = parseRate(card.cacheWrite5m);
  const num =
    BigInt(u.uncachedInput) * parseRate(card.input) +
    BigInt(u.output) * parseRate(card.output) +
    BigInt(u.cacheRead) * parseRate(card.cacheRead) +
    BigInt(u.cacheWrite5m) * w5 +
    BigInt(u.cacheWrite1h) * parseRate(card.cacheWrite1h) +
    BigInt(u.unsplitCacheWrite) * w5;
  return {
    ...base,
    microUsd: roundHalfUp(num, RATE_SCALE),
    priceQuality: u.unsplitCacheWrite > 0 ? 'estimated_fallback' : 'priced',
    rateModelId: entry.modelId,
    unpricedReason: null,
  };
}
