import { mkdirSync } from 'node:fs';
import { createRng, type Rng } from './prng.js';
import { Tree } from './tree.js';
import type { ExpectedTotals } from './types.js';

type SessionPlan = {
  cwd: string;
  sessionId: string;
  startMs: number;
  nReq: number;
  agentProb: number;
  roles: readonly string[];
  mainModel: (rng: Rng) => string;
  childModel: (rng: Rng) => string;
  snapshots: number;
  /** multiplier for token sizes */
  scale: number;
};

const uuid = (rng: Rng): string => `${rng.hex(8)}-${rng.hex(4)}-4${rng.hex(3)}-a${rng.hex(3)}-${rng.hex(12)}`;
const iso = (ms: number): string => new Date(ms).toISOString();

function usage(rng: Rng, scale: number) {
  const cacheRead = rng.chance(0.3) ? 0 : Math.round(rng.int(1000, 60000) * scale);
  const agg = rng.chance(0.4) ? 0 : Math.round(rng.int(500, 9000) * scale);
  const split = rng.chance(0.7);
  const c5 = split ? rng.int(0, agg) : 0;
  return {
    input: Math.max(1, Math.round(rng.int(1, 2000) * scale)),
    output: Math.max(2, Math.round(rng.int(5, 4000) * scale)),
    cacheRead,
    cwAgg: agg,
    ...(split ? { cw5: c5, cw1: agg - c5 } : {}),
  };
}

function emitSession(t: Tree, rng: Rng, p: SessionPlan): void {
  const main = t.main(p.cwd, p.sessionId);
  let emitted = 0;
  let ms = p.startMs;
  while (emitted < p.nReq) {
    ms += rng.int(4000, 90000);
    const delegate = p.nReq - emitted >= 2 && rng.chance(p.agentProb);
    const role = rng.pick(p.roles);
    const tools = delegate
      ? [{ name: (rng.chance(0.15) ? 'Task' : 'Agent') as 'Task' | 'Agent', role }]
      : rng.chance(0.1)
        ? [{ name: 'Bash' as const }]
        : undefined;
    const r = t.req(main, { ...usage(rng, p.scale), model: p.mainModel(rng), ts: iso(ms), snapshots: p.snapshots, tools });
    emitted++;
    if (delegate) {
      const k = Math.min(rng.int(1, 4), p.nReq - emitted);
      const child = t.child(p.cwd, p.sessionId, `a${rng.hex(7)}`, { role, toolUseId: r.toolIds[0] as string });
      for (let j = 0; j < k; j++) {
        ms += rng.int(3000, 30000);
        t.req(child, { ...usage(rng, p.scale * 0.6), model: p.childModel(rng), ts: iso(ms), snapshots: p.snapshots });
        emitted++;
      }
    }
  }
}

function weighted(rng: Rng, items: ReadonlyArray<readonly [string, number]>): string {
  const total = items.reduce((a, [, w]) => a + w, 0);
  let x = rng.next() * total;
  for (const [v, w] of items) {
    x -= w;
    if (x < 0) return v;
  }
  return items[items.length - 1]![0];
}

export type CorpusOptions = {
  requests: number;
  projects: number;
  seed: number;
  snapshotsPerRequest?: number;
  agentRatio?: number;
};

const CORPUS_MODELS = [
  ['claude-opus-5-5', 20],
  ['claude-sonnet-5-5', 40],
  ['claude-haiku-4-5', 20],
  ['claude-opus-4-7', 17],
  ['acme-unknown-model', 3],
] as const;
const CORPUS_ROLES = ['code-reviewer', 'test-runner', 'frontend-engineer', 'backend-engineer', 'docs-writer'] as const;

/** Deterministic synthetic corpus spread over ~60 days ending 2026-10-10. Returns generator-computed expected totals. */
export function generateCorpus(root: string, opts: CorpusOptions): ExpectedTotals {
  const rng = createRng(opts.seed);
  const t = new Tree('cp');
  const nProj = Math.max(1, opts.projects);
  const sessions = Math.max(nProj, Math.ceil(opts.requests / 30));
  const startDay = Date.parse('2026-08-12T00:00:00.000Z');
  let left = opts.requests;
  for (let i = 0; i < sessions && left > 0; i++) {
    const remainingSessions = sessions - i;
    const n = remainingSessions === 1 ? left : Math.min(left, Math.max(1, Math.round((left / remainingSessions) * (0.5 + rng.next()))));
    left -= n;
    emitSession(t, rng, {
      cwd: `/Users/demo/corpus/project-${String((i % nProj) + 1).padStart(3, '0')}`,
      sessionId: uuid(rng),
      startMs: startDay + rng.int(0, 59) * 86_400_000 + rng.int(6, 22) * 3_600_000 + rng.int(0, 59) * 60_000,
      nReq: n,
      agentProb: opts.agentRatio ?? 0.2,
      roles: CORPUS_ROLES,
      mainModel: (r) => weighted(r, CORPUS_MODELS),
      childModel: (r) => weighted(r, CORPUS_MODELS),
      snapshots: opts.snapshotsPerRequest ?? 2,
      scale: 1,
    });
  }
  mkdirSync(root, { recursive: true });
  t.writeTo(root);
  return t.totals();
}

const DEMO_PROJECTS = ['aurora-api', 'lumen-web', 'atlas-data', 'nimbus-cli', 'helios-docs', 'orion-mobile', 'vega-infra'] as const;
const DEMO_ROLES = ['code-reviewer', 'test-runner', 'frontend-engineer', 'backend-engineer', 'docs-writer'] as const;

/** Believable, clearly synthetic 45-day multi-project dataset ending 2026-10-14. Deterministic (seed 20261014). */
export function demoDataset(root: string): ExpectedTotals {
  const rng = createRng(20261014);
  const t = new Tree('demo');
  const start = Date.parse('2026-08-31T00:00:00.000Z');
  for (let d = 0; d < 45; d++) {
    const dayMs = start + d * 86_400_000;
    const dow = new Date(dayMs).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const nSessions = weekend ? rng.int(0, 1) : rng.int(3, 6);
    for (let s = 0; s < nSessions; s++) {
      const project = rng.pick(DEMO_PROJECTS);
      emitSession(t, rng, {
        cwd: `/Users/demo/dev/${project}`,
        sessionId: uuid(rng),
        startMs: dayMs + rng.int(8, 19) * 3_600_000 + rng.int(0, 59) * 60_000,
        nReq: rng.int(6, 28),
        agentProb: 0.25,
        roles: DEMO_ROLES,
        mainModel: (r) =>
          project === 'atlas-data' && r.chance(0.08)
            ? 'acme-unknown-model'
            : weighted(r, [
                ['claude-opus-5-5', 40],
                ['claude-sonnet-5-5', 45],
                ['claude-opus-4-7', 15],
              ]),
        childModel: (r) => weighted(r, [['claude-sonnet-5-5', 50], ['claude-haiku-5-5', 50]]),
        snapshots: 2,
        scale: 1,
      });
    }
  }
  mkdirSync(root, { recursive: true });
  t.writeTo(root);
  return t.totals();
}
