import { mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentsDTO, OverviewDTO } from '@orbit/core';
import { renderRequestLine, writeScenario } from '@orbit/test-fixtures';
import { WIDE, enableReal, get, makeEnv, type Env } from './helpers.js';

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

interface Snap {
  requests: number;
  /** Usage totals only: renaming a main file legitimately changes its session id (and thus session/project counts). */
  kpis: Pick<OverviewDTO['kpis'], 'uniqueRequests' | 'tokens' | 'cost'>;
  rows: number;
  archivedRows: number;
  absentFiles: number;
  agents: number;
}

async function snap(e: Env): Promise<Snap> {
  const store = e.app.orbit.realStore();
  const o = (await get<OverviewDTO>(e, `/api/v1/overview?${WIDE}`)).body;
  const a = (await get<AgentsDTO>(e, `/api/v1/agents?${WIDE}&limit=200`)).body;
  return {
    requests: o.kpis.uniqueRequests.value,
    kpis: { uniqueRequests: o.kpis.uniqueRequests, tokens: o.kpis.tokens, cost: o.kpis.cost },
    rows: store.get<{ n: number }>('SELECT COUNT(*) AS n FROM requests')?.n ?? -1,
    archivedRows: store.get<{ n: number }>('SELECT COUNT(*) AS n FROM requests WHERE source_present = 0')?.n ?? -1,
    absentFiles: store.get<{ n: number }>('SELECT COUNT(*) AS n FROM source_files WHERE present = 0')?.n ?? -1,
    agents: a.total,
  };
}

describe.each([
  ['archive ON', true],
  ['archive OFF', false],
])('renamed / moved source files (%s)', (_label, archive) => {
  it('renaming a main session file does not double count or lose usage', async () => {
    env = await makeEnv();
    await writeScenario('multiple-children', env.srcRoot);
    await enableReal(env, { archiveEnabled: archive });
    const before = await snap(env);
    expect(before.requests).toBeGreaterThan(0);

    const main = walkFiles(env.srcRoot).find((f) => f.endsWith('.jsonl') && !f.includes('subagents')) as string;
    renameSync(main, join(dirname(main), 'renamed-main-session.jsonl'));
    await env.app.orbit.scan();
    const after = await snap(env);
    expect(after.kpis).toEqual(before.kpis);
    expect(after.rows).toBe(before.rows);
    expect(after.archivedRows).toBe(0);
    expect(after.absentFiles).toBe(0);
    expect(after.agents).toBe(before.agents);

    // a second scan is stable
    await env.app.orbit.scan();
    expect(await snap(env)).toEqual(after);
  });

  it('renaming an agent file (and its meta) does not double count or lose usage', async () => {
    env = await makeEnv();
    await writeScenario('multiple-children', env.srcRoot);
    await enableReal(env, { archiveEnabled: archive });
    const before = await snap(env);
    const agent = walkFiles(env.srcRoot).find((f) => /agent-[^/]+\.jsonl$/.test(f)) as string;
    const meta = agent.replace(/\.jsonl$/, '.meta.json');
    renameSync(agent, join(dirname(agent), 'agent-renamed-child.jsonl'));
    renameSync(meta, join(dirname(agent), 'agent-renamed-child.meta.json'));
    await env.app.orbit.scan();
    const after = await snap(env);
    expect(after.kpis).toEqual(before.kpis);
    expect(after.rows).toBe(before.rows);
    expect(after.archivedRows).toBe(0);
    expect(after.absentFiles).toBe(0);
    expect(after.agents).toBe(before.agents);
    const ids = env.app.orbit.realStore().all<{ id: string }>('SELECT id FROM agents');
    expect(new Set(ids.map((x) => x.id)).size).toBe(ids.length);
  });

  it('moving a main file into another project folder keeps one copy of its usage', async () => {
    env = await makeEnv();
    await writeScenario('baseline', env.srcRoot);
    await enableReal(env, { archiveEnabled: archive });
    const before = await snap(env);
    const main = walkFiles(env.srcRoot).find((f) => f.endsWith('.jsonl') && !f.includes('subagents')) as string;
    const dest = join(env.srcRoot, '-Users-demo-moved-project');
    mkdirSync(dest, { recursive: true });
    renameSync(main, join(dest, 'moved-session.jsonl'));
    await env.app.orbit.scan();
    const after = await snap(env);
    expect(after.kpis.uniqueRequests.value).toBe(before.kpis.uniqueRequests.value);
    expect(after.kpis.tokens).toEqual(before.kpis.tokens);
    expect(after.rows).toBe(before.rows);
    expect(after.archivedRows).toBe(0);
  });

  it('does not remap when an unrelated file reuses the inode (different content)', async () => {
    env = await makeEnv();
    await writeScenario('baseline', env.srcRoot);
    await enableReal(env, { archiveEnabled: archive });
    const main = walkFiles(env.srcRoot).find((f) => f.endsWith('.jsonl') && !f.includes('subagents')) as string;
    const mainRows = env.app.orbit.realStore().get<{ n: number }>('SELECT COUNT(*) AS n FROM requests WHERE agent_id IS NULL')?.n ?? 0;
    const renamed = join(dirname(main), 'replacement-session.jsonl');
    renameSync(main, renamed);
    // same inode, entirely different content (written in place)
    const lines = [1, 2, 3].map((i) =>
      renderRequestLine({ sessionId: 'replacement-session', messageId: `msg_other_${i}`, usage: { input: 1, output: 1 }, timestamp: '2026-09-12T10:00:00.000Z', cwd: '/Users/demo/other' }),
    );
    writeFileSync(renamed, lines.join('\n') + '\n');
    await env.app.orbit.scan();
    const store = env.app.orbit.realStore();
    const live = store.get<{ n: number }>('SELECT COUNT(*) AS n FROM requests WHERE source_present = 1 AND session_id = ?', 'replacement-session')?.n;
    expect(live).toBe(3);
    const archivedMain = store.get<{ n: number }>('SELECT COUNT(*) AS n FROM requests WHERE agent_id IS NULL AND session_id <> ?', 'replacement-session')?.n ?? 0;
    expect(archivedMain).toBe(archive ? mainRows : 0);
  });
});
