import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  AgentDetailDTO, AgentsDTO, CostsDTO, OverviewDTO, Page, ProjectDetailDTO, ProjectSummary, SessionDetailDTO, SessionSummary, StatusDTO, StoryDTO, TimelineDTO,
} from '@orbit/core';
import { MONEY_DISCLAIMER_EN, formatMicroUsd } from '@orbit/core';
import { demoDataset, scenarios, writeAll, writeScenario } from '@orbit/test-fixtures';
import { MIGRATIONS } from '../src/db/index.js';
import { WIDE, enableReal, get, makeEnv, send, type Env } from './helpers.js';

let env: Env | undefined;
afterEach(async () => {
  await env?.cleanup();
  env = undefined;
});

describe('demo mode', () => {
  it('is generated from synthetic fixtures, needs no consent and never mixes with the real DB', async () => {
    env = await makeEnv();
    await writeAll(env.srcRoot);
    await enableReal(env);
    const realBefore = (await get<OverviewDTO>(env, `/api/v1/overview?${WIDE}`)).body;
    const realRows = env.app.orbit.realStore().get<{ c: number }>('SELECT COUNT(*) AS c FROM requests')?.c;

    const tmp = mkdtempSync(join(tmpdir(), 'orbit-demo-expected-'));
    const expected = demoDataset(tmp);
    rmSync(tmp, { recursive: true, force: true });

    const r = await send(env, 'PATCH', '/api/v1/settings', { activeDataset: 'demo' });
    expect(r.status).toBe(200);
    const demo = (await get<OverviewDTO>(env, `/api/v1/overview?${WIDE}`)).body;
    expect(demo.mode).toBe('demo');
    expect(demo.kpis.uniqueRequests.value).toBe(expected.uniqueRequests);
    expect(demo.kpis.tokens.output).toBe(expected.output);
    expect(demo.kpis.cost.unpricedRequestCount).toBe(expected.unknownModelRequests);
    expect(demo.kpis.projects.value).toBe(expected.projects);
    const st = (await get<StatusDTO>(env, '/api/v1/status')).body;
    expect(st.mode).toBe('demo');
    expect(st.sourceLabel).toBeNull();

    // real DB untouched, demo file separate
    expect(env.app.orbit.realStore().get<{ c: number }>('SELECT COUNT(*) AS c FROM requests')?.c).toBe(realRows);
    await send(env, 'PATCH', '/api/v1/settings', { activeDataset: 'real' });
    const realAfter = (await get<OverviewDTO>(env, `/api/v1/overview?${WIDE}`)).body;
    expect(realAfter.mode).toBe('real');
    expect(realAfter.kpis).toEqual(realBefore.kpis);
  });

  it('works without consent and rescans through the same pipeline', async () => {
    env = await makeEnv();
    await send(env, 'PATCH', '/api/v1/settings', { activeDataset: 'demo' });
    const st = (await get<StatusDTO>(env, '/api/v1/status')).body;
    expect(st.consentGranted).toBe(false);
    expect(st.mode).toBe('demo');
    const a = (await get<OverviewDTO>(env, `/api/v1/overview?${WIDE}`)).body;
    await env.app.orbit.scan();
    const b = (await get<OverviewDTO>(env, `/api/v1/overview?${WIDE}`)).body;
    expect(b.kpis).toEqual(a.kpis);
    expect(a.coverage.sourceStatus).not.toBe('not_scanned');
  });

  it('serves every read route with contract-shaped payloads', async () => {
    let now = Date.parse('2026-10-15T12:00:00.000Z');
    env = await makeEnv({ clock: () => now });
    await send(env, 'PATCH', '/api/v1/settings', { activeDataset: 'demo' });

    const o = (await get<OverviewDTO>(env, '/api/v1/overview')).body;
    expect(o.period.tz).toBe('Europe/Istanbul');
    expect(o.daily).toHaveLength(31);
    expect(o.kpis.cost.quality).toBe('estimated');
    expect(o.kpis.cost.reason).toBeTruthy();
    expect(o.models.length).toBeGreaterThan(1);
    expect(o.topProjects.length).toBeLessThanOrEqual(5);
    expect(o.topProjects[0]?.trend).toHaveLength(14);
    expect(o.agentLanes[0]?.hourly).toHaveLength(24);
    expect(o.insights.map((i) => i.kind)).toEqual(expect.arrayContaining(['most_active_project', 'cache_read_share', 'delegation_share', 'busiest_day', 'model_leader']));
    for (const i of o.insights) expect(i.evidenceHref.startsWith('/')).toBe(true);
    expect(o.previous).not.toBeNull();
    const dailySum = o.daily.reduce((n, d) => n + d.uniqueRequests, 0);
    expect(dailySum).toBe(o.kpis.uniqueRequests.value);
    const usdSum = o.daily.reduce((n, d) => n + BigInt(d.usdDecimal.replace('.', '')), 0n);
    expect(formatMicroUsd(usdSum)).toBe(o.kpis.cost.usdDecimal);

    const projects = (await get<Page<ProjectSummary>>(env, '/api/v1/projects?limit=2')).body;
    expect(projects.items).toHaveLength(2);
    expect(projects.nextCursor).toBeTruthy();
    expect(projects.total).toBeGreaterThan(2);
    const next = (await get<Page<ProjectSummary>>(env, `/api/v1/projects?limit=2&cursor=${projects.nextCursor}`)).body;
    expect(next.items[0]?.id).not.toBe(projects.items[0]?.id);
    expect((await get(env, '/api/v1/projects?cursor=garbage')).status).toBe(400);
    expect((await get(env, '/api/v1/projects?limit=201')).status).toBe(400);
    expect((await get(env, '/api/v1/projects?projectId=nope')).status).toBe(400);
    const byLabel = (await get<Page<ProjectSummary>>(env, '/api/v1/projects?sort=label&limit=50')).body.items.map((p) => p.label);
    expect(byLabel).toEqual([...byLabel].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));

    const pd = (await get<ProjectDetailDTO>(env, `/api/v1/projects/${projects.items[0]?.id}`)).body;
    expect(pd.project.id).toBe(projects.items[0]?.id);
    expect(pd.attribution.main.requests + pd.attribution.agents.requests).toBe(pd.project.requests);
    expect((await get(env, '/api/v1/projects/p_000000000000')).status).toBe(404);

    const sessions = (await get<Page<SessionSummary>>(env, '/api/v1/sessions?limit=5')).body;
    expect(sessions.items.length).toBe(5);
    const s0 = sessions.items[0] as SessionSummary;
    expect(s0.observedSpanMs.quality).toBe('estimated');
    const sd = (await get<SessionDetailDTO>(env, `/api/v1/sessions/${s0.id}`)).body;
    expect(sd.session.id).toBe(s0.id);
    expect(sd.requests.length).toBe(s0.requests);
    expect(sd.requests.every((r, i, a) => i === 0 || (a[i - 1] as { t: string }).t <= r.t)).toBe(true);

    const ag = (await get<AgentsDTO>(env, '/api/v1/agents?limit=10')).body;
    expect(ag.items.length).toBeGreaterThan(0);
    expect(ag.graph.nodes.length).toBeGreaterThan(0);
    expect(ag.graph.nodes.length).toBeLessThanOrEqual(300);
    expect(ag.graph.edges.every((e) => ag.graph.nodes.some((n) => n.id === e.from) && ag.graph.nodes.some((n) => n.id === e.to))).toBe(true);
    expect(ag.roles.length).toBeGreaterThan(0);
    expect(ag.totals.byConfidence.exact).toBeGreaterThan(0);
    const roleFiltered = (await get<AgentsDTO>(env, `/api/v1/agents?role=${ag.roles[0]}`)).body;
    expect(roleFiltered.items.every((a) => a.role === ag.roles[0])).toBe(true);
    const adet = (await get<AgentDetailDTO>(env, `/api/v1/agents/${ag.items[0]?.id}`)).body;
    expect(adet.agent.status).toBe('historical');
    expect(adet.evidence.confidence).toBe(adet.agent.confidence);
    expect(adet.parentSession?.id).toBe(adet.agent.sessionId);

    const tl = (await get<TimelineDTO>(env, '/api/v1/timeline?groupBy=project')).body;
    expect(tl.lanes.length).toBeGreaterThan(1);
    const ivs = tl.lanes.flatMap((l) => l.intervals);
    expect(ivs.every((i) => i.start <= i.end)).toBe(true);
    const tla = (await get<TimelineDTO>(env, '/api/v1/timeline?groupBy=agent&limit=5')).body;
    expect(tla.lanes.length).toBeLessThanOrEqual(5);

    const costs = (await get<CostsDTO>(env, '/api/v1/costs')).body;
    expect(costs.schedule.version).toMatch(/^anthropic/);
    expect(costs.schedule.notModeled.length).toBeGreaterThan(0);
    expect(costs.unpriced.some((u) => u.modelId === 'acme-unknown-model')).toBe(true);
    const catSum = (Object.values(costs.byCategory) as { usdDecimal: string }[]).reduce((n, c) => n + BigInt(c.usdDecimal.replace('.', '')), 0n);
    const total = BigInt(costs.cost.usdDecimal.replace('.', ''));
    const diff = catSum > total ? catSum - total : total - catSum;
    // category rows round half-up once per category, totals once per request: |diff| < requests (micro-USD)
    expect(diff <= BigInt(costs.cost.pricedRequestCount)).toBe(true);
    expect(costs.byModel.find((m) => m.modelId === 'acme-unknown-model')?.rate).toBeNull();

    const story = (await get<StoryDTO>(env, '/api/v1/reports/summary')).body;
    expect(story.mode).toBe('demo');
    expect(story.delegation.agentShare).toBeGreaterThan(0);
    expect(story.cache.cacheReadShare + story.cache.cacheWriteShare + story.cache.uncachedInputShare).toBeLessThanOrEqual(1);

    const modelFiltered = (await get<OverviewDTO>(env, '/api/v1/overview?modelId=acme-unknown-model')).body;
    expect(modelFiltered.kpis.cost.unpricedRequestCount).toBe(modelFiltered.kpis.uniqueRequests.value);

    // status recency: agents become observed_recently when the clock is close to their last event
    const last = Date.parse(adet.agent.lastAt as string);
    now = last + 60_000;
    const recent = (await get<AgentDetailDTO>(env, `/api/v1/agents/${ag.items[0]?.id}`)).body;
    expect(recent.agent.status).toBe('observed_recently');

    expect(MONEY_DISCLAIMER_EN).toBeTruthy();
    const diag = (await get<{ schemaVersion: number; dbSizeBytes: number }>(env, '/api/v1/diagnostics')).body;
    expect(diag.schemaVersion).toBe(MIGRATIONS.length);
    expect(diag.dbSizeBytes).toBeGreaterThan(0);
  });
});

describe('timezone bucketing', () => {
  it('matches the dst-days scenario for New York, Istanbul and UTC', async () => {
    env = await makeEnv();
    await writeScenario('dst-days', env.srcRoot);
    await enableReal(env);
    const daily = scenarios['dst-days']?.daily as Record<string, Record<string, number>>;
    for (const tz of Object.keys(daily)) {
      const o = (await get<OverviewDTO>(env, `/api/v1/overview?${WIDE}&tz=${encodeURIComponent(tz)}`)).body;
      const got: Record<string, number> = {};
      for (const d of o.daily) if (d.uniqueRequests > 0) got[d.date] = d.uniqueRequests;
      expect(got, tz).toEqual(daily[tz]);
      expect(o.period.tz).toBe(tz);
    }
    // default tz comes from settings
    await send(env, 'PATCH', '/api/v1/settings', { timezone: 'America/New_York' });
    const o = (await get<OverviewDTO>(env, `/api/v1/overview?${WIDE}`)).body;
    expect(o.period.tz).toBe('America/New_York');
    expect((await get(env, '/api/v1/overview?tz=Not/AZone')).status).toBe(400);
  });
});
