import { readFileSync, renameSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { OverviewDTO, StatusDTO } from '@orbit/core';
import { appendRequest, writeScenario } from '@orbit/test-fixtures';
import { WIDE, enableReal, get, makeEnv, send, type Env } from './helpers.js';

let env: Env | undefined;
afterEach(async () => {
  await env?.cleanup();
  env = undefined;
});

function findJsonl(dir: string): string {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.jsonl') && !p.includes('subagents')) out.push(p);
    }
  };
  walk(dir);
  return out[0] as string;
}

async function waitFor(cond: () => Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

const requests = async (e: Env): Promise<number> => (await get<OverviewDTO>(e, `/api/v1/overview?${WIDE}`)).body.kpis.uniqueRequests.value;

describe('watcher', () => {
  it('fs.watch (debounced) ingests appended lines and bumps the revision', async () => {
    env = await makeEnv();
    await writeScenario('streaming-duplicates', env.srcRoot);
    await enableReal(env);
    env.app.orbit.syncWatcher();
    const st = (await get<StatusDTO>(env, '/api/v1/status')).body;
    expect(['watching', 'polling']).toContain(st.watcher);
    const base = await requests(env);
    const rev = st.revision;
    appendRequest(findJsonl(env.srcRoot), { sessionId: 'stream-session-001', messageId: 'msg_watch_1', usage: { input: 1, output: 1, cacheRead: 0 }, timestamp: '2026-09-03T10:00:00.000Z' });
    expect(await waitFor(async () => (await requests(env as Env)) === base + 1, 6000)).toBe(true);
    expect((await get<StatusDTO>(env, '/api/v1/status')).body.revision).toBeGreaterThan(rev);
  }, 15000);

  it('polling fallback picks up changes at the configured interval', async () => {
    env = await makeEnv({ forcePolling: true });
    await writeScenario('streaming-duplicates', env.srcRoot);
    await enableReal(env, { watchIntervalMs: 2000 });
    expect((await get<StatusDTO>(env, '/api/v1/status')).body.watcher).toBe('polling');
    const base = await requests(env);
    appendRequest(findJsonl(env.srcRoot), { sessionId: 'stream-session-001', messageId: 'msg_poll_1', usage: { input: 1, output: 1, cacheRead: 0 }, timestamp: '2026-09-03T10:00:00.000Z' });
    expect(await waitFor(async () => (await requests(env as Env)) === base + 1, 8000)).toBe(true);
  }, 15000);

  it('no watcher without consent and none in demo mode', async () => {
    env = await makeEnv();
    env.app.orbit.syncWatcher();
    expect((await get<StatusDTO>(env, '/api/v1/status')).body.watcher).toBe('off');
    await send(env, 'PATCH', '/api/v1/settings', { activeDataset: 'demo' });
    expect((await get<StatusDTO>(env, '/api/v1/status')).body.watcher).toBe('off');
  });

  it('a replaced file (new inode, larger) is rescanned from zero without double counting', async () => {
    env = await makeEnv();
    await writeScenario('streaming-duplicates', env.srcRoot);
    await enableReal(env);
    const file = findJsonl(env.srcRoot);
    const original = readFileSync(file, 'utf8');
    const extra = original.split('\n').filter((l) => l.includes('"assistant"'));
    const tmp = file + '.new';
    writeFileSync(tmp, original + extra.join('\n') + '\n'); // same messages replayed => same ids
    renameSync(tmp, file);
    const before = await requests(env);
    await env.app.orbit.scan();
    expect(await requests(env)).toBe(before);
  });
});

describe('bad files', () => {
  it('counts an unreadable file and keeps scanning the rest', async () => {
    const { chmodSync } = await import('node:fs');
    env = await makeEnv();
    await writeScenario('multiple-children', env.srcRoot);
    await writeScenario('baseline', env.srcRoot);
    const victim = (function find(d: string): string {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) {
          const r = find(p);
          if (r) return r;
        } else if (p.endsWith('base-session-001.jsonl')) return p;
      }
      return '';
    })(env.srcRoot);
    chmodSync(victim, 0o000);
    try {
      await enableReal(env);
      const o = (await get<OverviewDTO>(env, `/api/v1/overview?${WIDE}`)).body;
      expect(o.kpis.uniqueRequests.value).toBeGreaterThan(0);
      const diag = (await get<{ discovery: { unreadable: number } }>(env, '/api/v1/diagnostics')).body;
      expect(diag.discovery.unreadable).toBeGreaterThanOrEqual(1);
      expect(o.coverage.sourceStatus).toBe('partial');
    } finally {
      chmodSync(victim, 0o600);
    }
  });
});
