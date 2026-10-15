import { describe, expect, it } from 'vitest';
import {
  MONEY_LABEL_EN,
  MONEY_LABEL_TR,
  addUsage,
  formatMicroUsd,
  getDefaultSchedule,
  mergeSchedules,
  normalizeModelId,
  parseRate,
  priceRequest,
  processedTokens,
  rateEntriesSchema,
  resolveRate,
  summarizeCosts,
} from '../src/cost/index.js';
import type { RateEntry, TokenUsage } from '../src/schemas/types.js';

const S = getDefaultSchedule();
const u = (p: Partial<TokenUsage>): TokenUsage => ({
  uncachedInput: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, unsplitCacheWrite: 0, ...p,
});
const T = '2026-10-10T00:00:00.000Z';
const price = (model: string | null, usage: TokenUsage, ts: string | null = T, sched = S) =>
  priceRequest({ dedupeKey: 'k', model, timestamp: ts, usage }, sched);

describe('schedule', () => {
  it('every entry has 5 rate classes and valid decimals', () => {
    expect(S.entries.length).toBe(20);
    for (const e of S.entries) {
      for (const c of [e.rates, e.longPromptTier?.rates]) {
        if (!c) continue;
        expect(Object.keys(c).sort()).toEqual(['cacheRead', 'cacheWrite1h', 'cacheWrite5m', 'input', 'output']);
        for (const v of Object.values(c)) expect(() => parseRate(v)).not.toThrow();
      }
    }
    expect(Object.isFrozen(S.entries[0])).toBe(true);
    expect(S.version).toBe('anthropic-2026-10-15');
  });
  it('labels', () => {
    expect(MONEY_LABEL_EN).toBe('Estimated API-equivalent value (USD)');
    expect(MONEY_LABEL_TR).toContain('USD');
  });
});

describe('fixtures', () => {
  it('main opus-5 request', () => {
    const p = price('claude-opus-5', u({ uncachedInput: 10, output: 25, cacheRead: 60, cacheWrite5m: 40 }));
    expect(p.microUsd).toBe(BigInt((10 * 5 * 100 + 25 * 25 * 100 + 60 * 50 + 40 * 625) / 100));
    expect(p.microUsd).toBe(955n);
    expect(p.priceQuality).toBe('priced');
  });
  it('child sonnet-5 request', () => {
    const p = price('claude-sonnet-5', u({ uncachedInput: 8, output: 13, cacheRead: 20, cacheWrite5m: 12 }));
    expect(p.microUsd).toBe(180n);
  });
  it('unknown model is unpriced and drops coverage', () => {
    const a = priceRequest({ dedupeKey: 'a', model: 'claude-opus-5', timestamp: T, usage: u({ output: 100 }) }, S);
    const b = priceRequest({ dedupeKey: 'b', model: 'model-unsupported-for-test', timestamp: T, usage: u({ output: 100 }) }, S);
    expect(b.microUsd).toBeNull();
    expect(b.unpricedReason).toBe('unknown_model');
    const sum = summarizeCosts(
      [a, b],
      new Map([['a', u({ output: 100 })], ['b', u({ output: 100 })]]),
      S,
      new Map([['b', 'model-unsupported-for-test']]),
    );
    expect(sum.usdDecimal).toBe('0.002500');
    expect(sum.requestCoverage).toBe(0.5);
    expect(sum.tokenCoverage).toBe(0.5);
    expect(sum.unpricedModels).toEqual(['model-unsupported-for-test']);
    expect(sum.unpricedTokens).toBe(100);
    expect(sum.reason).toBe('API rate equivalent, not a subscription charge');
  });
  it('fixture total (3 requests)', () => {
    const usage = new Map<string, TokenUsage>();
    const reqs = [
      ['m', 'claude-opus-5', u({ uncachedInput: 10, output: 25, cacheRead: 60, cacheWrite5m: 40 })],
      ['c', 'claude-sonnet-5', u({ uncachedInput: 8, output: 13, cacheRead: 20, cacheWrite5m: 12 })],
      ['x', 'model-unsupported-for-test', u({ output: 5 })],
    ] as const;
    const priced = reqs.map(([k, m, us]) => {
      usage.set(k, us);
      return priceRequest({ dedupeKey: k, model: m, timestamp: T, usage: us }, S);
    });
    const s = summarizeCosts(priced, usage, S);
    expect(s.usdDecimal).toBe('0.001135');
    expect(s.pricedRequestCount).toBe(2);
    expect(s.unpricedRequestCount).toBe(1);
  });
  it('cache 300 = 100 5m + 200 1h charges only the split', () => {
    const p = price('claude-opus-5', u({ cacheWrite5m: 100, cacheWrite1h: 200 }));
    expect(p.microUsd).toBe(100n * 625n / 100n + 200n * 10n); // 625 + 2000
    expect(p.microUsd).toBe(2625n);
  });
  it('unsplit cache write uses 5m rate and is estimated_fallback', () => {
    const p = price('claude-opus-5', u({ unsplitCacheWrite: 100 }));
    expect(p.microUsd).toBe(625n);
    expect(p.priceQuality).toBe('estimated_fallback');
  });
  it('mid-month schedule change prices the earlier request with the old rate', () => {
    const ov: RateEntry[] = [
      { modelId: 'claude-opus-5', displayName: 'o', aliases: [], effectiveFrom: '2026-10-15T00:00:00.000Z', effectiveTo: null,
        rates: { input: '1', output: '1', cacheRead: '1', cacheWrite5m: '1', cacheWrite1h: '1' }, source: 'user_override' },
    ];
    const m = mergeSchedules(S, ov);
    expect(m.version).toMatch(/^anthropic-2026-10-15\+local-[0-9a-f]{8}$/);
    const us = u({ output: 1_000_000 });
    expect(price('claude-opus-5', us, '2026-10-14T23:59:59.000Z', m).microUsd).toBe(25_000_000n);
    expect(price('claude-opus-5', us, '2026-10-15T00:00:00.000Z', m).microUsd).toBe(1_000_000n);
    expect(mergeSchedules(S, [])).toBe(S);
  });
});

describe('haiku-5-5 long prompt tier', () => {
  it('boundary 100000 vs 100001', () => {
    const lo = price('claude-haiku-5-5', u({ uncachedInput: 100000, output: 1000 }));
    const hi = price('claude-haiku-5-5', u({ uncachedInput: 100001, output: 1000 }));
    expect(lo.microUsd).toBe(100000n * 100000n / 1_000_000n + 500n); // 10000 + 500
    expect(hi.microUsd).toBe(52501n);
  });
  it('counts cache tokens toward the prompt and applies tier to all classes', () => {
    const p = price('claude-haiku-5-5', u({ uncachedInput: 1, cacheRead: 100000, output: 1000000 }));
    // 1*0.5 + 100000*0.05 + 1e6*2.5 = 2505000.5 -> half up
    expect(p.microUsd).toBe(2505001n);
  });
});

describe('resolve', () => {
  it('normalizes date snapshots and [1m]', () => {
    expect(normalizeModelId('  Claude-Sonnet-4-5-20250929 ')).toBe('claude-sonnet-4-5');
    expect(normalizeModelId('claude-opus-5[1m]')).toBe('claude-opus-5');
    const r = resolveRate(S, 'claude-sonnet-4-5-20250929', T);
    expect(r.ok && r.entry.modelId).toBe('claude-sonnet-4-5');
  });
  it('does not strip platform prefixes', () => {
    for (const m of ['us.anthropic.claude-sonnet-4-5', 'anthropic.claude-sonnet-4-5', 'claude-sonnet-4-5@20250929']) {
      expect(resolveRate(S, m, T)).toEqual({ ok: false, reason: 'unknown_model' });
    }
  });
  it('missing/synthetic', () => {
    expect(resolveRate(S, null, T)).toEqual({ ok: false, reason: 'missing_model' });
    expect(resolveRate(S, '  ', T)).toEqual({ ok: false, reason: 'missing_model' });
    expect(resolveRate(S, '<synthetic>', T)).toEqual({ ok: false, reason: 'unknown_model' });
    expect(price('<synthetic>', u({ output: 5 })).microUsd).toBeNull();
  });
  it('no_rate_for_time and null timestamp', () => {
    const e: RateEntry = { modelId: 'x-model', displayName: 'x', aliases: [], effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: '2026-02-01T00:00:00.000Z', rates: { input: '1', output: '1', cacheRead: '1', cacheWrite5m: '1', cacheWrite1h: '1' }, source: 'user_override' };
    const m = mergeSchedules(S, [e]);
    expect(resolveRate(m, 'x-model', '2026-03-01T00:00:00.000Z')).toEqual({ ok: false, reason: 'no_rate_for_time' });
    expect(price('x-model', u({ output: 1 }), null, m).microUsd).toBe(1n);
    expect(price('claude-opus-5', u({ output: 1 }), null).priceQuality).toBe('priced');
  });
});

describe('exact arithmetic', () => {
  it('1e12 tokens has no precision loss', () => {
    const p = price('claude-opus-5', u({ output: 1e12 }));
    expect(p.microUsd).toBe(25_000_000_000_000n);
    expect(formatMicroUsd(p.microUsd as bigint)).toBe('25000000.000000');
  });
  it('sums 1000 requests exactly', () => {
    const us = u({ uncachedInput: 3, output: 1, cacheRead: 7 }); // 3*5+25+3.5 = 43.5 -> 44
    const priced = Array.from({ length: 1000 }, (_, i) => priceRequest({ dedupeKey: `k${i}`, model: 'claude-opus-5', timestamp: T, usage: us }, S));
    expect(priced[0]?.microUsd).toBe(44n);
    const usage = new Map(priced.map((p) => [p.dedupeKey, us]));
    expect(summarizeCosts(priced, usage, S).usdDecimal).toBe('0.044000');
  });
  it('formats and empty summary', () => {
    expect(formatMicroUsd(42100n)).toBe('0.042100');
    expect(formatMicroUsd(0n)).toBe('0.000000');
    const s = summarizeCosts([], new Map(), S);
    expect(s.requestCoverage).toBe(1);
    expect(s.pricedRequestCount).toBe(0);
  });
  it('usage helpers', () => {
    const a = u({ uncachedInput: 1, output: 2, cacheRead: 3, cacheWrite5m: 4, cacheWrite1h: 5, unsplitCacheWrite: 6 });
    expect(processedTokens(a)).toBe(21);
    expect(processedTokens(addUsage(a, a))).toBe(42);
  });
  it('rejects malformed rates', () => {
    expect(() => parseRate('-1')).toThrow();
    expect(() => parseRate('1e3')).toThrow();
  });
});

describe('zod validation', () => {
  const base: RateEntry = { modelId: 'm', displayName: 'm', aliases: [], effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: null,
    rates: { input: '1', output: '1', cacheRead: '1', cacheWrite5m: '1', cacheWrite1h: '1' }, source: 'user_override' };
  it('rejects negative rates', () => {
    expect(rateEntriesSchema.safeParse([{ ...base, rates: { ...base.rates, input: '-1' } }]).success).toBe(false);
  });
  it('rejects effectiveTo <= effectiveFrom', () => {
    expect(rateEntriesSchema.safeParse([{ ...base, effectiveTo: '2026-01-01T00:00:00.000Z' }]).success).toBe(false);
  });
  it('rejects overlapping intervals, accepts adjacent', () => {
    const a = { ...base, effectiveTo: '2026-02-01T00:00:00.000Z' };
    expect(rateEntriesSchema.safeParse([a, { ...base, effectiveFrom: '2026-01-15T00:00:00.000Z' }]).success).toBe(false);
    expect(rateEntriesSchema.safeParse([a, { ...base, effectiveFrom: '2026-02-01T00:00:00.000Z' }]).success).toBe(true);
    expect(() => mergeSchedules(S, [base, base])).toThrow();
  });
});
