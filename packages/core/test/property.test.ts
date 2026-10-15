import { describe, expect, it } from 'vitest';
import { createRng, type Rng } from '@orbit/test-fixtures';
import { dedupeSnapshots, type DedupeContext } from '../src/parser/index.js';
import { formatMicroUsd, getDefaultSchedule, priceRequest, summarizeCosts } from '../src/cost/index.js';
import type { AssistantSnapshot, TokenUsage, UniqueRequest } from '../src/schemas/types.js';

const CTX: DedupeContext = { sourceKind: 'main', sourceFileId: 'prop', namespace: 'main:prop' };
const ITER = 200;

function randomSnapshots(rng: Rng): AssistantSnapshot[] {
  const nMsg = rng.int(1, 8);
  const out: AssistantSnapshot[] = [];
  let offset = 0;
  for (let m = 0; m < nMsg; m++) {
    const n = rng.int(1, 6);
    const base = Date.parse('2026-10-01T00:00:00Z') + rng.int(0, 1000) * 1000;
    for (let i = 0; i < n; i++) {
      // Small ranges force ties on output and timestamp so tie-breaking by lineOffset is exercised.
      out.push({
        type: 'assistant',
        timestamp: rng.chance(0.1) ? null : new Date(base + rng.int(0, 3) * 1000).toISOString(),
        sessionId: 's1',
        agentId: null,
        cwd: null,
        version: null,
        uuid: `u${offset}`,
        requestId: null,
        messageId: `msg_${m}`,
        model: 'claude-sonnet-5-5',
        stopReason: null,
        usage: {
          uncachedInput: rng.int(0, 50),
          output: rng.int(0, 6),
          cacheRead: rng.int(0, 50),
          cacheWrite5m: rng.int(0, 20),
          cacheWrite1h: rng.int(0, 20),
          unsplitCacheWrite: rng.int(0, 5),
        },
        cacheCreationAggregate: 0,
        tasks: [],
        lineOffset: (offset += rng.int(10, 500)),
      });
    }
  }
  return out;
}

function shuffle<T>(rng: Rng, xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [a[i], a[j]] = [a[j] as T, a[i] as T];
  }
  return a;
}

const byKey = (rs: UniqueRequest[]): Map<string, TokenUsage> => new Map(rs.map((r) => [r.dedupeKey, r.usage]));
const asSnapshot = (r: UniqueRequest): AssistantSnapshot => ({
  type: 'assistant',
  timestamp: r.timestamp,
  sessionId: r.sessionId,
  agentId: r.agentId,
  cwd: null,
  version: null,
  uuid: null,
  requestId: r.requestId,
  messageId: r.messageId,
  model: r.model,
  stopReason: r.stopReason,
  usage: r.usage,
  cacheCreationAggregate: 0,
  tasks: r.tasks,
  lineOffset: 0,
});

describe('dedupeSnapshots properties (seeded)', () => {
  it('is order independent', () => {
    const rng = createRng(1001);
    for (let i = 0; i < ITER; i++) {
      const snaps = randomSnapshots(rng);
      const a = byKey(dedupeSnapshots(snaps, CTX));
      const b = byKey(dedupeSnapshots(shuffle(rng, snaps), CTX));
      expect(b).toEqual(a);
    }
  });

  it('is idempotent (re-dedupe of its own output, and of the input fed twice)', () => {
    const rng = createRng(1002);
    for (let i = 0; i < ITER; i++) {
      const snaps = randomSnapshots(rng);
      const once = dedupeSnapshots(snaps, CTX);
      const twice = dedupeSnapshots(once.map(asSnapshot), CTX);
      expect(byKey(twice)).toEqual(byKey(once));
      expect(twice.length).toBe(once.length);
      expect(byKey(dedupeSnapshots([...snaps, ...snaps], CTX))).toEqual(byKey(once));
    }
  });

  it('output total equals the sum of per-message max output; one request per message', () => {
    const rng = createRng(1003);
    for (let i = 0; i < ITER; i++) {
      const snaps = randomSnapshots(rng);
      const max = new Map<string, number>();
      for (const s of snaps) max.set(s.messageId!, Math.max(max.get(s.messageId!) ?? 0, s.usage.output));
      const reqs = dedupeSnapshots(snaps, CTX);
      expect(reqs.length).toBe(max.size);
      expect(reqs.reduce((a, r) => a + r.usage.output, 0)).toBe([...max.values()].reduce((a, b) => a + b, 0));
      expect(reqs.reduce((a, r) => a + r.snapshotCount, 0)).toBe(snaps.length);
    }
  });
});

describe('priceRequest properties (seeded)', () => {
  const schedule = getDefaultSchedule();
  const models = schedule.entries.map((e) => e.modelId);
  const AT = '2026-10-16T00:00:00.000Z';
  const randUsage = (rng: Rng, scale: number): TokenUsage => ({
    uncachedInput: rng.int(0, scale),
    output: rng.int(0, scale),
    cacheRead: rng.int(0, scale),
    cacheWrite5m: rng.int(0, scale),
    cacheWrite1h: rng.int(0, scale),
    unsplitCacheWrite: rng.int(0, scale),
  });

  it('is additive: per-request micro-USD sums to the summary total', () => {
    const rng = createRng(2001);
    for (let i = 0; i < ITER; i++) {
      const n = rng.int(1, 20);
      const usageByKey = new Map<string, TokenUsage>();
      const priced = Array.from({ length: n }, (_, j) => {
        const usage = randUsage(rng, rng.chance(0.2) ? 400_000 : 5000);
        usageByKey.set(`k${j}`, usage);
        return priceRequest({ dedupeKey: `k${j}`, model: rng.chance(0.1) ? 'acme-unknown-model' : rng.pick(models), timestamp: AT, usage }, schedule);
      });
      const total = priced.reduce((a, p) => a + (p.microUsd ?? 0n), 0n);
      const s = summarizeCosts(priced, usageByKey, schedule);
      expect(s.usdDecimal).toBe(formatMicroUsd(total));
      expect(s.pricedRequestCount + s.unpricedRequestCount).toBe(n);
      expect(priced.every((p) => (p.microUsd === null) === (p.priceQuality === 'unpriced'))).toBe(true);
    }
  });

  it('is monotonic: adding tokens in any class never makes a request cheaper', () => {
    const rng = createRng(2002);
    const keys = ['uncachedInput', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h', 'unsplitCacheWrite'] as const;
    for (let i = 0; i < ITER * 5; i++) {
      const model = rng.pick(models);
      const u = randUsage(rng, rng.chance(0.3) ? 300_000 : 5000);
      const more = { ...u };
      more[rng.pick(keys)] += rng.int(0, 200_000);
      const a = priceRequest({ dedupeKey: 'a', model, timestamp: AT, usage: u }, schedule).microUsd;
      const b = priceRequest({ dedupeKey: 'b', model, timestamp: AT, usage: more }, schedule).microUsd;
      expect(a).not.toBeNull();
      expect(b! >= a!, `${model} ${JSON.stringify(u)} -> ${JSON.stringify(more)}`).toBe(true);
    }
  });
});
