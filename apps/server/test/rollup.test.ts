import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { appendRequest, generateCorpus, writeAll } from '@orbit/test-fixtures';
import { MIGRATIONS, Store } from '../src/db/index.js';
import { rebuildRollup, refreshRollup, rollupValid, sourceSql } from '../src/db/rollup.js';
import { MISSING_MODEL } from '../src/api/filters.js';
import { enableReal, get, makeEnv, send, type Env } from './helpers.js';

const NOW = Date.parse('2026-10-12T00:00:00Z');
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

const dump = (st: Store): string =>
  JSON.stringify(
    st.all(
      'SELECT * FROM request_buckets ORDER BY bucket, project_id, session_id, agent_id, model',
    ),
  );

const URLS = [
  '/api/v1/overview',
  '/api/v1/overview?from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z',
  '/api/v1/overview?from=2026-09-01T03:07:11.123Z&to=2026-09-20T10:07:31.456Z',
  '/api/v1/overview?from=2026-09-20T10:01:00Z&to=2026-09-20T10:04:00Z', // inside one bucket: direct path
  '/api/v1/overview?from=2026-09-20T10:01:00Z&to=2026-09-20T11:44:00Z', // few buckets, both edges partial
  '/api/v1/overview?from=2026-08-01T00:00:00Z&to=2026-10-12T00:00:00Z&tz=America/New_York',
  '/api/v1/overview?from=2026-08-01T00:00:00Z&to=2026-10-12T00:00:00Z&modelId=claude-sonnet-5-5',
  '/api/v1/overview?from=2026-08-01T00:00:00Z&to=2026-10-12T00:00:00Z&modelId=acme-unknown-model',
  `/api/v1/overview?from=2026-08-01T00:00:00Z&to=2026-10-12T00:00:00Z&modelId=${encodeURIComponent(MISSING_MODEL)}`,
  '/api/v1/reports/summary',
  '/api/v1/reports/summary?from=2026-09-03T05:00:00Z&to=2026-09-25T22:30:00Z&tz=Europe/Istanbul',
  '/api/v1/costs',
  '/api/v1/costs?from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z',
  '/api/v1/costs?from=2026-09-03T05:07:00Z&to=2026-09-25T22:31:00Z&modelId=claude-opus-5-5',
  '/api/v1/projects?limit=200',
  '/api/v1/projects?limit=200&sort=cost',
  '/api/v1/projects?limit=200&sort=requests&from=2026-09-03T05:07:00Z&to=2026-09-25T22:31:00Z',
  '/api/v1/projects?limit=200&sort=recent',
  '/api/v1/projects?limit=200&sort=label',
  '/api/v1/projects?limit=7&sort=tokens&from=2026-09-03T05:07:00Z&to=2026-09-25T22:31:00Z&modelId=claude-haiku-4-5',
  '/api/v1/agents?limit=200',
  '/api/v1/exports?format=json',
  '/api/v1/exports?format=csv&from=2026-09-03T05:07:00Z&to=2026-09-25T22:31:00Z',
  '/api/v1/exports?format=csv&from=2026-09-03T05:07:00Z&to=2026-09-25T22:31:00Z&tz=America/New_York&modelId=claude-sonnet-5-5',
];

async function bothWays(e: Env, urls: string[]): Promise<void> {
  const rt = e.app.orbit;
  for (const url of urls) {
    rt.rollupEnabled = true;
    const a = await get(e, url);
    rt.rollupEnabled = false;
    const b = await get(e, url);
    rt.rollupEnabled = true;
    expect(a.status, url).toBe(200);
    expect(b.status, url).toBe(200);
    expect(a.raw, url).toBe(b.raw);
  }
}

describe('maintained 15-minute rollup', () => {
  it('every aggregate endpoint returns identical JSON with rollup vs direct queries (writeAll + 10k corpus)', async () => {
    env = await makeEnv({ clock: () => NOW });
    await writeAll(env.srcRoot);
    generateCorpus(env.srcRoot, { requests: 10_000, projects: 6, seed: 7 });
    await enableReal(env);
    const store = env.app.orbit.realStore();
    expect(rollupValid(store)).toBe(true);
    const total = store.get<{ n: number }>('SELECT COUNT(*) AS n FROM requests')?.n ?? 0;
    expect(total).toBeGreaterThan(10_000);
    expect(store.get<{ n: number }>('SELECT SUM(n) AS n FROM request_buckets')?.n).toBe(total);
    // the rollup is really used for these ranges (and not for sub-bucket ranges)
    expect(sourceSql(store, { fromMs: 0, toMs: NOW }, true, MISSING_MODEL).usedRollup).toBe(true);
    expect(sourceSql(store, { fromMs: NOW - 60_000, toMs: NOW }, true, MISSING_MODEL).usedRollup).toBe(false);
    expect(sourceSql(store, { fromMs: 0, toMs: NOW }, false, MISSING_MODEL).usedRollup).toBe(false);
    const ov = (await get<{ kpis: { uniqueRequests: { value: number } } }>(env, URLS[1] as string)).body;
    expect(ov.kpis.uniqueRequests.value).toBe(total);
    await bothWays(env, URLS);
  });

  it('stays exactly equal to a full rebuild after appends, rewrites, deletes (FK cascade) and archive flips', async () => {
    env = await makeEnv({ clock: () => NOW });
    await writeAll(env.srcRoot);
    generateCorpus(env.srcRoot, { requests: 1500, projects: 3, seed: 11 });
    await enableReal(env);
    const store = env.app.orbit.realStore();
    const check = async (label: string): Promise<void> => {
      expect(rollupValid(store), label).toBe(true);
      const maintained = dump(store);
      rebuildRollup(store);
      expect(dump(store), label).toBe(maintained);
      await bothWays(env as Env, URLS.slice(0, 12));
    };
    await check('initial');

    const files = walkFiles(env.srcRoot).filter((f) => f.endsWith('.jsonl') && !f.includes('subagents'));
    const main = files[0] as string;
    const sid = (main.split('/').pop() as string).replace('.jsonl', '');
    appendRequest(main, { sessionId: sid, messageId: 'msg_rollup_a', usage: { input: 5, output: 6, cacheRead: 1 }, timestamp: '2026-09-02T10:00:00.000Z' });
    appendRequest(main, { sessionId: sid, messageId: 'msg_rollup_b', model: 'acme-unknown-model', usage: { input: 5, output: 6, cacheRead: 1 }, timestamp: '2026-09-02T10:01:00.000Z' });
    await env.app.orbit.scan();
    await check('append');

    appendRequest(main, { sessionId: sid, messageId: 'msg_rollup_a', usage: { input: 5, output: 60, cacheRead: 1 }, timestamp: '2026-09-02T10:00:01.000Z' });
    await env.app.orbit.scan();
    await check('snapshot upgrade');

    writeFileSync(files[1] as string, '');
    await env.app.orbit.scan();
    await check('truncate');

    unlinkSync(files[2] as string);
    await env.app.orbit.scan();
    await check('delete (archive off, FK cascade)');

    await send(env, 'PATCH', '/api/v1/settings', { archiveEnabled: true });
    await env.app.orbit.scan();
    unlinkSync(files[3] as string);
    await env.app.orbit.scan();
    await check('delete (archive on, source_present flip)');
    const arch = store.get<{ n: number }>('SELECT COALESCE(SUM(arch),0) AS n FROM request_buckets')?.n ?? 0;
    expect(arch).toBeGreaterThan(0);
  });

  it('falls back to direct queries while buckets are dirty and heals on refresh', async () => {
    env = await makeEnv({ clock: () => NOW });
    await writeAll(env.srcRoot);
    await enableReal(env);
    const store = env.app.orbit.realStore();
    const before = (await get(env, URLS[1] as string)).raw;
    store.run('INSERT INTO dirty_buckets(bucket) VALUES (1)');
    expect(rollupValid(store)).toBe(false);
    expect(sourceSql(store, { fromMs: 0, toMs: NOW }, true, MISSING_MODEL).usedRollup).toBe(false);
    expect((await get(env, URLS[1] as string)).raw).toBe(before);
    expect(refreshRollup(store)).toBe(1);
    expect(rollupValid(store)).toBe(true);
    expect((await get(env, URLS[1] as string)).raw).toBe(before);
  });

  it('migration 2 backfills the rollup from an existing v1 database and then maintains it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'orbit-mig-'));
    try {
      mkdirSync(dir, { recursive: true });
      const raw = new DatabaseSync(join(dir, 'orbit.sqlite'));
      raw.exec(MIGRATIONS[0] as string);
      raw.exec('CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (1);');
      raw.exec("INSERT INTO source_files(id, kind, rel_path, project_dir, session_id) VALUES ('f1','main','-Users-x-proj/s1.jsonl','-Users-x-proj','s1')");
      const ins = raw.prepare(
        `INSERT INTO requests(dedupe_key, dedupe_quality, source_file_id, source_kind, session_id, project_id, model, ts_ms, uncached_input, output,
           cache_read, cache_write_5m, cache_write_1h, unsplit_cache_write, micro_usd, price_quality, source_present)
         VALUES (?, 'exact', 'f1', 'main', 's1', 'p_1', ?, ?, ?, ?, 0, 0, 0, 0, ?, ?, 1)`,
      );
      ins.run('k1', 'claude-sonnet-5-5', 1_800_000_000_000, 10, 20, 100, 'priced');
      ins.run('k2', 'claude-sonnet-5-5', 1_800_000_000_500, 1, 2, null, 'unpriced');
      ins.run('k3', 'acme-unknown-model', 1_800_000_900_000 + 5, 3, 4, null, 'unpriced');
      raw.close();
      const store = new Store('real', dir);
      expect(store.schemaVersion).toBe(MIGRATIONS.length);
      expect(rollupValid(store)).toBe(true);
      const maintained = dump(store);
      expect(JSON.parse(maintained)).toHaveLength(2);
      store.run("UPDATE requests SET output = 99 WHERE dedupe_key = 'k1'");
      expect(rollupValid(store)).toBe(false);
      refreshRollup(store);
      const after = dump(store);
      rebuildRollup(store);
      expect(dump(store)).toBe(after);
      expect(after).not.toBe(maintained);
      store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never lets rows without a timestamp into the rollup (derived timestamps are applied first)', async () => {
    env = await makeEnv({ clock: () => NOW });
    await writeAll(env.srcRoot);
    await enableReal(env);
    const store = env.app.orbit.realStore();
    const noTs = store.get<{ n: number }>('SELECT COUNT(*) AS n FROM requests WHERE ts_ms IS NULL')?.n;
    expect(noTs).toBe(0); // derived timestamps are applied in rebuildDerived
    expect(store.get<{ n: number }>('SELECT SUM(n) AS n FROM request_buckets')?.n).toBe(store.get<{ n: number }>('SELECT COUNT(*) AS n FROM requests')?.n);
  });
});
