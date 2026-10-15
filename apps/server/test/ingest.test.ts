import { appendFileSync, existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentsDTO, CostsDTO, OverviewDTO, StatusDTO } from '@orbit/core';
import { appendPartial, appendRequest, combinedExpected, scenarios, writeAll, writeScenario } from '@orbit/test-fixtures';
import { WIDE, enableReal, get, makeEnv, send, type Env } from './helpers.js';

let env: Env | undefined;
afterEach(async () => {
  await env?.cleanup();
  env = undefined;
});

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walkFiles(p));
    else out.push(p);
  }
  return out.sort();
}
function hashTree(dir: string): string {
  const h = createHash('sha256');
  for (const f of walkFiles(dir)) h.update(f).update(readFileSync(f));
  return h.digest('hex');
}

async function overview(e: Env): Promise<OverviewDTO> {
  return (await get<OverviewDTO>(e, `/api/v1/overview?${WIDE}`)).body;
}

describe('consent gate', () => {
  it('does not scan and reports not_scanned before consent', async () => {
    env = await makeEnv();
    await writeScenario('baseline', env.srcRoot);
    const st = await get<StatusDTO>(env, '/api/v1/status');
    expect(st.body.consentGranted).toBe(false);
    expect(st.body.mode).toBe('none');
    const scan = await send(env, 'POST', '/api/v1/scan');
    expect(scan.status).toBe(403);
    expect((scan.body as { error: { code: string } }).error.code).toBe('CONSENT_REQUIRED');
    await env.app.orbit.scan();
    const o = await overview(env);
    expect(o.coverage.sourceStatus).toBe('not_scanned');
    expect(o.kpis.uniqueRequests.value).toBe(0);
    expect(o.mode).toBe('none');
  });
});

describe('totals vs generator expectations', () => {
  it('matches combinedExpected for all scenarios', async () => {
    env = await makeEnv();
    await writeAll(env.srcRoot);
    await enableReal(env);
    const o = await overview(env);
    const t = o.kpis.tokens;
    expect(o.kpis.uniqueRequests.value).toBe(combinedExpected.uniqueRequests);
    expect(t.uncachedInput).toBe(combinedExpected.uncachedInput);
    expect(t.output).toBe(combinedExpected.output);
    expect(t.cacheRead).toBe(combinedExpected.cacheRead);
    expect(t.cacheWrite5m).toBe(combinedExpected.cacheWrite5m);
    expect(t.cacheWrite1h).toBe(combinedExpected.cacheWrite1h);
    expect(t.unsplitCacheWrite).toBe(combinedExpected.unsplitCacheWrite);
    expect(o.kpis.cost.unpricedRequestCount).toBe(combinedExpected.unknownModelRequests);
    expect(o.kpis.cost.quality).toBe('estimated');
    expect(o.coverage.malformedLineCount).toBe(combinedExpected.malformedLines);
    const c = await get<CostsDTO>(env, `/api/v1/costs?${WIDE}`);
    expect(c.body.cost.unpricedRequestCount).toBe(combinedExpected.unknownModelRequests);
    expect(c.body.cost.usdDecimal).toBe(o.kpis.cost.usdDecimal);
    expect(c.body.cost.unpricedModels.length).toBeGreaterThan(0);
    const a = await get<AgentsDTO>(env, `/api/v1/agents?${WIDE}&limit=200`);
    expect(a.body.totals.byConfidence.exact).toBe(combinedExpected.exactLinks);
    expect(a.body.totals.byConfidence.inferred).toBe(combinedExpected.inferredLinks);
    expect(a.body.totals.byConfidence.unlinked).toBe(combinedExpected.unlinkedAgents);
    expect(o.kpis.projects.value).toBe(combinedExpected.projects);
  });

  it('every scenario individually matches its expectations', async () => {
    for (const [name, sc] of Object.entries(scenarios)) {
      const e = await makeEnv();
      try {
        await writeScenario(name, e.srcRoot);
        await enableReal(e);
        const o = await overview(e);
        expect(o.kpis.uniqueRequests.value, name).toBe(sc.expected.uniqueRequests);
        expect(o.kpis.tokens.uncachedInput, name).toBe(sc.expected.uncachedInput);
        expect(o.kpis.tokens.output, name).toBe(sc.expected.output);
        expect(o.kpis.tokens.cacheRead, name).toBe(sc.expected.cacheRead);
        expect(o.kpis.tokens.cacheWrite5m, name).toBe(sc.expected.cacheWrite5m);
        expect(o.kpis.tokens.cacheWrite1h, name).toBe(sc.expected.cacheWrite1h);
        expect(o.kpis.tokens.unsplitCacheWrite, name).toBe(sc.expected.unsplitCacheWrite);
        expect(o.kpis.cost.unpricedRequestCount, name).toBe(sc.expected.unknownModelRequests);
      } finally {
        await e.cleanup();
      }
    }
  });

  it('is idempotent across rescans and a restart', async () => {
    env = await makeEnv();
    await writeAll(env.srcRoot);
    await enableReal(env);
    const first = await overview(env);
    await env.app.orbit.scan();
    await env.app.orbit.scan();
    const again = await overview(env);
    expect(again.kpis).toEqual(first.kpis);
    const reuse = { root: env.root, dataDir: env.dataDir, srcRoot: env.srcRoot };
    await env.app.close();
    const e2 = await makeEnv({ reuse });
    env = e2;
    expect((await get<StatusDTO>(e2, '/api/v1/status')).body.consentGranted).toBe(true);
    const restarted = await overview(e2);
    expect(restarted.kpis).toEqual(first.kpis);
    await e2.app.orbit.scan();
    expect((await overview(e2)).kpis).toEqual(first.kpis);
  });
});

describe('incremental ingestion', () => {
  it('counts appended requests, waits for partial lines and upgrades duplicate snapshots', async () => {
    env = await makeEnv();
    await writeScenario('streaming-duplicates', env.srcRoot);
    await enableReal(env);
    const before = await overview(env);
    const file = walkFiles(env.srcRoot).find((f) => f.endsWith('.jsonl')) as string;

    appendRequest(file, { sessionId: 'stream-session-001', messageId: 'msg_new_inc_1', usage: { input: 3, output: 4, cacheRead: 0 }, timestamp: '2026-09-02T10:00:00.000Z' });
    await env.app.orbit.scan();
    const plus1 = await overview(env);
    expect(plus1.kpis.uniqueRequests.value).toBe(before.kpis.uniqueRequests.value + 1);
    expect(plus1.kpis.tokens.output).toBe(before.kpis.tokens.output + 4);

    // partial line is not counted until completed
    appendPartial(file, '{"type":"assistant","sessionId":"stream-session-001"');
    await env.app.orbit.scan();
    expect((await overview(env)).kpis.uniqueRequests.value).toBe(plus1.kpis.uniqueRequests.value);
    const rest = JSON.stringify({ type: 'assistant', sessionId: 'stream-session-001', uuid: 'u-part', timestamp: '2026-09-02T10:05:00.000Z', requestId: 'req_part', message: { id: 'msg_partial_done', model: 'claude-sonnet-5-5', usage: { input_tokens: 2, output_tokens: 2 } } }).slice('{"type":"assistant","sessionId":"stream-session-001"'.length);
    appendPartial(file, rest + '\n');
    await env.app.orbit.scan();
    expect((await overview(env)).kpis.uniqueRequests.value).toBe(plus1.kpis.uniqueRequests.value + 1);

    // a later, bigger snapshot of an existing message upgrades instead of duplicating
    const now = await overview(env);
    appendRequest(file, { sessionId: 'stream-session-001', messageId: 'msg_new_inc_1', usage: { input: 3, output: 9, cacheRead: 0 }, timestamp: '2026-09-02T10:00:01.000Z' });
    await env.app.orbit.scan();
    const up = await overview(env);
    expect(up.kpis.uniqueRequests.value).toBe(now.kpis.uniqueRequests.value);
    expect(up.kpis.tokens.output).toBe(now.kpis.tokens.output + 5);
  });

  it('does not double count when a file is truncated / rewritten smaller', async () => {
    env = await makeEnv();
    await writeScenario('streaming-duplicates', env.srcRoot);
    await enableReal(env);
    const file = walkFiles(env.srcRoot).find((f) => f.endsWith('.jsonl')) as string;
    const before = await overview(env);
    const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
    // keep only the preamble + first assistant message (rewrite smaller)
    const kept = lines.filter((l, i) => i < 4);
    writeFileSync(file, kept.join('\n') + '\n');
    await env.app.orbit.scan();
    const after = await overview(env);
    expect(after.kpis.uniqueRequests.value).toBeLessThan(before.kpis.uniqueRequests.value);
    expect(after.kpis.uniqueRequests.value).toBe(1);
    // replay of the original content brings back exactly the original totals
    writeFileSync(file, lines.join('\n') + '\n');
    await env.app.orbit.scan();
    expect((await overview(env)).kpis).toEqual(before.kpis);
  });
});

describe('archive semantics', () => {
  it('archive OFF deletes rows of vanished files; ON keeps them flagged', async () => {
    env = await makeEnv();
    await writeScenario('multiple-children', env.srcRoot);
    await writeScenario('unknown-model', env.srcRoot);
    await enableReal(env, { archiveEnabled: false });
    const full = await overview(env);
    const victim = walkFiles(env.srcRoot).find((f) => f.includes('unk-session'))!;
    rmSync(victim);
    await env.app.orbit.scan();
    const off = await overview(env);
    expect(off.kpis.uniqueRequests.value).toBe(full.kpis.uniqueRequests.value - 2);
    expect(off.coverage.archivedOnlyRequestCount).toBe(0);

    await send(env, 'PATCH', '/api/v1/settings', { archiveEnabled: true });
    await env.app.orbit.scan();
    // recreate then remove with archive ON
    await writeScenario('unknown-model', env.srcRoot);
    await env.app.orbit.scan();
    expect((await overview(env)).kpis.uniqueRequests.value).toBe(full.kpis.uniqueRequests.value);
    rmSync(walkFiles(env.srcRoot).find((f) => f.includes('unk-session'))!);
    await env.app.orbit.scan();
    const on = await overview(env);
    expect(on.kpis.uniqueRequests.value).toBe(full.kpis.uniqueRequests.value);
    expect(on.coverage.archivedOnlyRequestCount).toBe(2);
    expect(on.coverage.sourceStatus).toBe('partial');
  });

  it('DELETE /archive removes only Orbit data and never touches source files', async () => {
    env = await makeEnv();
    await writeAll(env.srcRoot);
    const srcHash = hashTree(env.srcRoot);
    await enableReal(env);
    expect(existsSync(join(env.dataDir, 'orbit.sqlite'))).toBe(true);
    const bad = await send(env, 'DELETE', '/api/v1/archive', { confirm: 'nope' });
    expect(bad.status).toBe(400);
    const noCsrf = await env.app.inject({ method: 'DELETE', url: '/api/v1/archive', headers: { host: 'localhost:4317', 'content-type': 'application/json' }, payload: '{"confirm":"DELETE_ORBIT_DATA"}' });
    expect(noCsrf.statusCode).toBe(403);
    const ok = await send(env, 'DELETE', '/api/v1/archive', { confirm: 'DELETE_ORBIT_DATA' });
    expect(ok.status).toBe(200);
    expect(hashTree(env.srcRoot)).toBe(srcHash);
    const o = await overview(env);
    expect(o.kpis.uniqueRequests.value).toBe(0);
    expect(o.coverage.sourceStatus).toBe('not_scanned');
    // settings (consent) are kept
    expect((await get<StatusDTO>(env, '/api/v1/status')).body.consentGranted).toBe(true);
  });
});

describe('scan rate limit', () => {
  it('limits manual rescans to 1 per 3 s', async () => {
    let now = 1_800_000_000_000;
    env = await makeEnv({ clock: () => now });
    await writeScenario('baseline', env.srcRoot);
    await enableReal(env);
    now += 10_000;
    const a = await send(env, 'POST', '/api/v1/scan');
    expect(a.status).toBe(202);
    const b = await send(env, 'POST', '/api/v1/scan');
    expect(b.status).toBe(429);
    expect((b.body as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
    now += 3_100;
    expect((await send(env, 'POST', '/api/v1/scan')).status).toBe(202);
    await env.app.orbit.scan();
  });
});

void appendFileSync;
