import { afterEach, describe, expect, it } from 'vitest';
import type { AgentsDTO, ExportMeta, Page, ProjectSummary, SessionSummary } from '@orbit/core';
import { EXPORT_COLUMNS } from '@orbit/core';
import { scanForCanaries, writeAll, writeScenario } from '@orbit/test-fixtures';
import { WIDE, enableReal, get, makeEnv, send, type Env } from './helpers.js';

let env: Env | undefined;
afterEach(async () => {
  await env?.cleanup();
  env = undefined;
});

function dumpTables(e: Env, kind: 'real' | 'demo'): string {
  const store = kind === 'real' ? e.app.orbit.realStore() : e.app.orbit.store();
  const tables = store.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").map((t) => t.name);
  const out: Record<string, unknown[]> = {};
  for (const t of tables) out[t] = store.all(`SELECT * FROM ${t}`);
  return JSON.stringify(out, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
}

async function allGetResponses(e: Env): Promise<string[]> {
  const out: string[] = [];
  const grab = async (url: string): Promise<{ status: number; body: unknown }> => {
    const r = await get(e, url);
    out.push(r.raw);
    return { status: r.status, body: r.body };
  };
  for (const u of ['/health', '/api/v1/session', '/api/v1/status', '/api/v1/settings', '/api/v1/diagnostics', `/api/v1/overview?${WIDE}`, `/api/v1/costs?${WIDE}`, `/api/v1/reports/summary?${WIDE}`, `/api/v1/timeline?${WIDE}&groupBy=project`, `/api/v1/timeline?${WIDE}&groupBy=agent`, `/api/v1/exports?${WIDE}&format=csv`, `/api/v1/exports?${WIDE}&format=json`]) {
    const r = await grab(u);
    expect(r.status, u).toBe(200);
  }
  const projects = (await grab(`/api/v1/projects?${WIDE}&limit=200`)).body as Page<ProjectSummary>;
  const sessions = (await grab(`/api/v1/sessions?${WIDE}&limit=200`)).body as Page<SessionSummary>;
  const agents = (await grab(`/api/v1/agents?${WIDE}&limit=200`)).body as AgentsDTO;
  for (const p of projects.items) expect((await grab(`/api/v1/projects/${p.id}?${WIDE}`)).status).toBe(200);
  for (const s of sessions.items) expect((await grab(`/api/v1/sessions/${s.id}`)).status).toBe(200);
  for (const a of agents.items) expect((await grab(`/api/v1/agents/${a.id}`)).status).toBe(200);
  return out;
}

describe('privacy: no leaks in DB, API or exports', () => {
  it('contains no canaries, source paths or data-dir paths (real + demo)', async () => {
    env = await makeEnv();
    await writeAll(env.srcRoot);
    await enableReal(env);

    const check = async (label: string): Promise<void> => {
      const responses = await allGetResponses(env as Env);
      expect(responses.length).toBeGreaterThan(20);
      const joined = responses.join('\n');
      expect(scanForCanaries(joined), `${label} api`).toEqual([]);
      for (const needle of ['/Users/demo', (env as Env).dataDir, (env as Env).srcRoot, (env as Env).root]) {
        expect(joined.includes(needle), `${label}: ${needle}`).toBe(false);
      }
    };
    await check('real');
    const dumpReal = dumpTables(env, 'real');
    expect(dumpReal.length).toBeGreaterThan(1000);
    expect(scanForCanaries(dumpReal)).toEqual([]);
    expect(dumpReal.includes('/Users/demo')).toBe(false);
    expect(dumpReal.includes(env.root)).toBe(false);

    const sw = await send(env, 'PATCH', '/api/v1/settings', { activeDataset: 'demo' });
    expect(sw.status).toBe(200);
    await check('demo');
    const dumpDemo = dumpTables(env, 'demo');
    expect(scanForCanaries(dumpDemo)).toEqual([]);
    expect(dumpDemo.includes('/Users/demo')).toBe(false);
    expect(dumpDemo.includes(env.root)).toBe(false);
  });
});

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  return rows;
}

describe('exports', () => {
  it('neutralizes CSV formulas and wraps JSON with ExportMeta', async () => {
    env = await makeEnv();
    await writeScenario('formula-names', env.srcRoot);
    await writeScenario('unknown-model', env.srcRoot);
    await enableReal(env);

    const csv = await env.app.inject({ method: 'GET', url: `/api/v1/exports?${WIDE}&format=csv`, headers: { host: 'localhost:4317' } });
    expect(csv.statusCode).toBe(200);
    expect(String(csv.headers['content-disposition'])).toMatch(/^attachment; filename="orbit-export-\d{8}\.csv"$/);
    expect(String(csv.headers['content-type'])).toContain('text/csv');
    const rows = parseCsv(csv.body);
    expect(rows[0]).toEqual([...EXPORT_COLUMNS]);
    const dataRows = rows.slice(1).filter((r) => r.length > 1);
    expect(dataRows.length).toBeGreaterThan(4);
    const labels = dataRows.map((r) => r[2] as string);
    for (const lbl of ['\'=HYPERLINK("x")', "'+1", "'@cmd", "'-2+3"]) expect(labels).toContain(lbl);
    for (const r of dataRows) {
      for (const cell of r) expect(/^[=+\-@\t\r]/.test(cell), cell).toBe(false);
      expect(r.length).toBe(EXPORT_COLUMNS.length);
    }
    // unpriced rows are empty, never 0
    const unpriced = dataRows.find((r) => r[3] === 'acme-unknown-model') as string[];
    expect(unpriced[11]).toBe('');
    expect(unpriced[12]).toBe('unpriced');

    const json = await env.app.inject({ method: 'GET', url: `/api/v1/exports?${WIDE}&format=json`, headers: { host: 'localhost:4317' } });
    expect(String(json.headers['content-disposition'])).toContain('attachment');
    const body = JSON.parse(json.body) as { meta: ExportMeta; rows: Record<string, unknown>[] };
    expect(body.meta.source_mode).toBe('local_claude_code');
    expect(body.meta.estimate_type).toBe('api_price_equivalent');
    expect(body.meta.rate_schedule_version).toMatch(/anthropic/);
    expect(body.meta.unknown_priced_requests).toBe(1);
    expect(body.meta.excluded_unknown_models).toEqual(['acme-unknown-model']);
    expect(body.meta.coverage_window.from).toBeTruthy();
    expect(body.meta.coverage_window.to).toBeTruthy();
    expect(body.meta.disclaimer).toMatch(/Not a Pro\/Max bill/);
    expect(body.meta.columns).toEqual([...EXPORT_COLUMNS]);
    expect(body.rows.length).toBe(dataRows.length);
    expect(Object.keys(body.rows[0] as object)).toEqual([...EXPORT_COLUMNS]);
    expect((await get(env, '/api/v1/exports?format=xml')).status).toBe(400);
    expect((await get(env, '/api/v1/exports')).status).toBe(400);
  });

  it('alias is local, sanitized, shown in exports; label HTML is plain text', async () => {
    env = await makeEnv();
    await writeScenario('html-payloads', env.srcRoot);
    await enableReal(env);
    const projects = (await get<Page<ProjectSummary>>(env, `/api/v1/projects?${WIDE}`)).body;
    expect(projects.items).toHaveLength(1);
    const p = projects.items[0] as ProjectSummary;
    expect(p.label).toBe('<img src=x onerror=alert(1)>');
    const put = await send<ProjectSummary>(env, 'PUT', `/api/v1/projects/${p.id}/alias`, { alias: '  My\u0007 project  ' });
    expect(put.status).toBe(200);
    expect(put.body.alias).toBe('My project');
    expect((await send(env, 'PUT', `/api/v1/projects/${p.id}/alias`, { alias: 'x'.repeat(61) })).status).toBe(400);
    expect((await send(env, 'PUT', `/api/v1/projects/${p.id}/alias`, { alias: 5 })).status).toBe(400);
    expect((await send(env, 'PUT', `/api/v1/projects/p_ffffffffffff/alias`, { alias: 'z' })).status).toBe(404);
    const csv = (await get(env, `/api/v1/exports?${WIDE}&format=csv`)).raw;
    expect(csv).toContain('My project');
    const cleared = await send<ProjectSummary>(env, 'PUT', `/api/v1/projects/${p.id}/alias`, { alias: null });
    expect(cleared.body.alias).toBeNull();
  });
});
