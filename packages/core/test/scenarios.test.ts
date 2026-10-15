import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { combinedExpected, scanForCanaries, scenarios, writeAll, writeScenario, type ExpectedTotals } from '@orbit/test-fixtures';
import { runPipeline, type PipelineResult } from './pipeline.js';

const tmps: string[] = [];
const mk = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'orbit-scn-'));
  tmps.push(d);
  return d;
};
afterAll(() => tmps.forEach((d) => rmSync(d, { recursive: true, force: true })));

function actualFor(r: PipelineResult): ExpectedTotals {
  const count = (c: string): number => r.links.filter((l) => l.confidence === c).length;
  return {
    uniqueRequests: r.requests.length,
    uncachedInput: r.usage.uncachedInput,
    output: r.usage.output,
    cacheRead: r.usage.cacheRead,
    cacheWrite5m: r.usage.cacheWrite5m,
    cacheWrite1h: r.usage.cacheWrite1h,
    unsplitCacheWrite: r.usage.unsplitCacheWrite,
    exactLinks: count('exact'),
    inferredLinks: count('inferred'),
    unlinkedAgents: count('unlinked'),
    unknownModelRequests: r.unknownModelRequests,
    malformedLines: r.warnings.MALFORMED_JSON ?? 0,
    projects: r.projects,
    sessions: r.sessions,
  };
}

function expectMatches(actual: ExpectedTotals, expected: ExpectedTotals): void {
  const picked: Partial<ExpectedTotals> = {};
  for (const k of Object.keys(expected) as (keyof ExpectedTotals)[]) if (expected[k] !== null) picked[k] = actual[k];
  const want: Partial<ExpectedTotals> = {};
  for (const k of Object.keys(expected) as (keyof ExpectedTotals)[]) if (expected[k] !== null) want[k] = expected[k];
  expect(picked).toEqual(want);
}

function expectClean(r: PipelineResult): void {
  const json = JSON.stringify({ requests: r.requests, links: r.links, warnings: r.warnings, usage: r.usage });
  expect(scanForCanaries(json)).toEqual([]);
  expect(json).not.toContain('/Users/demo');
}

describe('core pipeline vs generator expectations', () => {
  for (const [name, s] of Object.entries(scenarios)) {
    it(`${name}: totals match`, async () => {
      const root = mk();
      await writeScenario(name, root);
      const r = await runPipeline(root);
      expectMatches(actualFor(r), s.expected);
      expectClean(r);
    });
  }

  it('writeAll: combined totals match', async () => {
    const root = mk();
    await writeAll(root);
    const r = await runPipeline(root);
    expectMatches(actualFor(r), combinedExpected);
    expectClean(r);
  });

  it('scenario-specific warnings', async () => {
    const check = async (name: string): Promise<PipelineResult> => {
      const root = mk();
      await writeScenario(name, root);
      return runPipeline(root);
    };
    expect((await check('invalid-utf8')).warnings.INVALID_UTF8).toBe(1);
    expect((await check('huge-line')).warnings.LINE_TOO_LONG).toBe(1);
    expect((await check('split-exceeds-aggregate')).warnings.CACHE_SPLIT_EXCEEDS_AGGREGATE).toBe(1);
    const inf = await check('inferred-link');
    expect(inf.links.map((l) => [l.confidence, l.reason])).toEqual([['inferred', 'session_dir_role_unique']]);
    const orph = await check('nested-orphan-grandchild');
    expect(orph.links.map((l) => l.confidence).sort()).toEqual(['exact', 'unlinked']);
  });
});
