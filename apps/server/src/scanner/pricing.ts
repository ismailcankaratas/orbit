import { priceRequest, type PriceInput, type RateSchedule } from '@orbit/core';
import type { Store } from '../db/index.js';

export function toMicroNumber(v: bigint | null): number | null {
  if (v === null) return null;
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('micro-USD overflow');
  return Number(v);
}

interface RepriceRow {
  dedupe_key: string;
  model: string | null;
  ts_ms: number | null;
  uncached_input: number;
  output: number;
  cache_read: number;
  cache_write_5m: number;
  cache_write_1h: number;
  unsplit_cache_write: number;
}

export function priceRow(r: RepriceRow, schedule: RateSchedule) {
  const input: PriceInput = {
    dedupeKey: r.dedupe_key,
    model: r.model,
    timestamp: r.ts_ms === null ? null : new Date(r.ts_ms).toISOString(),
    usage: {
      uncachedInput: r.uncached_input,
      output: r.output,
      cacheRead: r.cache_read,
      cacheWrite5m: r.cache_write_5m,
      cacheWrite1h: r.cache_write_1h,
      unsplitCacheWrite: r.unsplit_cache_write,
    },
  };
  return priceRequest(input, schedule);
}

/** Re-price every request when the active schedule version differs from the stored one. Returns true if repriced. */
export function repriceIfNeeded(store: Store, schedule: RateSchedule): boolean {
  if (store.getMeta('priced_schedule_version') === schedule.version) return false;
  store.tx(() => {
    const rows = store.all<RepriceRow>(
      'SELECT dedupe_key, model, ts_ms, uncached_input, output, cache_read, cache_write_5m, cache_write_1h, unsplit_cache_write FROM requests',
    );
    for (const r of rows) {
      const p = priceRow(r, schedule);
      store.run(
        'UPDATE requests SET micro_usd = ?, price_quality = ?, rate_model_id = ?, rate_version = ? WHERE dedupe_key = ?',
        toMicroNumber(p.microUsd),
        p.priceQuality,
        p.rateModelId,
        schedule.version,
        r.dedupe_key,
      );
    }
    store.setMeta('priced_schedule_version', schedule.version);
  });
  return true;
}
