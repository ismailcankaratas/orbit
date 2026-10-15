import { mkdirSync } from 'node:fs';
import { PAYLOADS, CANARIES } from './canaries.js';
import { Tree } from './tree.js';
import { sumTotals, type ExpectedTotals, type Scenario } from './types.js';

type Def = (t: Tree) => void | Record<string, Record<string, number>>;

const dev = (n: string): string => `/Users/demo/dev/${n}`;
const registry: Record<string, Scenario> = {};

function define(name: string, description: string, fn: Def): void {
  const dry = new Tree(name.slice(0, 6));
  const daily = fn(dry) ?? undefined;
  registry[name] = {
    name,
    description,
    expected: dry.totals(),
    ...(daily ? { daily } : {}),
    async build(root: string) {
      mkdirSync(root, { recursive: true });
      const t = new Tree(name.slice(0, 6));
      fn(t);
      t.writeTo(root);
    },
  };
}

define('baseline', 'Mirrors fixtures/synthetic-home: streaming parent, exact child, unknown-model request, plus user/summary/system lines.', (t) => {
  const cwd = dev('baseline');
  const f = t.main(cwd, 'base-session-001');
  t.req(f, { id: 'msg_base_main_01', model: 'claude-opus-5', input: 10, output: 25, outputs: [5, 25], cacheRead: 60, cw5: 40, cw1: 0, tools: [{ id: 'toolu_base_child_01', name: 'Agent', role: 'frontend-engineer' }, { name: 'Bash' }] });
  t.req(f, { id: 'msg_base_unknown_01', model: 'model-unsupported-for-test', input: 5, output: 5, cacheRead: 0, cwAgg: 0 });
  const c = t.child(cwd, 'base-session-001', 'base-01', { role: 'frontend-engineer', toolUseId: 'toolu_base_child_01' });
  t.req(c, { id: 'msg_base_child_01', model: 'claude-sonnet-5', input: 8, output: 13, cacheRead: 20, cw5: 12, cw1: 0 });
});

define('streaming-duplicates', 'One message.id written as 3 snapshots with output 5 -> 19 -> 25 (plus a 5-snapshot request). Counts once at the final output.', (t) => {
  const f = t.main(dev('streaming-duplicates'), 'stream-session-001');
  t.req(f, { id: 'msg_dup_01', input: 10, output: 25, outputs: [5, 19, 25], cacheRead: 60, cw5: 40, cw1: 0 });
  t.req(f, { id: 'msg_dup_02', input: 7, output: 100, snapshots: 5, cacheRead: 11, cw5: 3, cw1: 4 });
});

define('multiple-children', 'One parent request spawns three children (three Agent tool_uses), each with two requests.', (t) => {
  const cwd = dev('multiple-children');
  const f = t.main(cwd, 'multi-session-001');
  const roles = ['code-reviewer', 'test-runner', 'frontend-engineer'];
  const r = t.req(f, { input: 12, output: 30, cacheRead: 100, cw5: 20, cw1: 0, tools: roles.map((role) => ({ name: 'Agent' as const, role })) });
  roles.forEach((role, i) => {
    const c = t.child(cwd, 'multi-session-001', `multi-${i + 1}`, { role, toolUseId: r.toolIds[i] as string });
    t.req(c, { input: 4 + i, output: 9 + i, cacheRead: 10, cw5: 5, cw1: 0 });
    t.req(c, { input: 6 + i, output: 11 + i, cacheRead: 14, cw5: 0, cw1: 2, snapshots: 2 });
  });
});

define('nested-depth', 'Depth 2: main spawns child; child spawns grandchild via its own Agent tool_use. Grandchild file lives in the same session subagents dir.', (t) => {
  const cwd = dev('nested-depth');
  const f = t.main(cwd, 'nest-session-001');
  const a = t.req(f, { input: 10, output: 20, cacheRead: 50, cw5: 10, cw1: 0, tools: [{ name: 'Agent', role: 'code-reviewer' }] });
  const c = t.child(cwd, 'nest-session-001', 'nest-child', { role: 'code-reviewer', toolUseId: a.toolIds[0] as string, depth: 1 });
  const b = t.req(c, { input: 5, output: 8, cacheRead: 30, cw5: 6, cw1: 0, tools: [{ name: 'Agent', role: 'test-runner' }] });
  const g = t.child(cwd, 'nest-session-001', 'nest-grand', { role: 'test-runner', toolUseId: b.toolIds[0] as string, depth: 2 });
  t.req(g, { input: 3, output: 4, cacheRead: 9, cw5: 1, cw1: 1 });
});

define('orphan-child', 'Child meta toolUseId matches no parent tool_use: unlinked, but its usage is still counted.', (t) => {
  const cwd = dev('orphan-child');
  const f = t.main(cwd, 'orphan-session-001');
  t.req(f, { input: 10, output: 20, cacheRead: 5, cw5: 5, cw1: 0, tools: [{ name: 'Agent', role: 'test-runner' }] });
  const c = t.child(cwd, 'orphan-session-001', 'orphan-01', { role: 'test-runner', toolUseId: 'toolu_does_not_exist_999' });
  t.req(c, { input: 7, output: 9, cacheRead: 3, cw5: 2, cw1: 0 });
});

define('unknown-model', 'A request with an unpriced model (tokens present) next to a known-model request.', (t) => {
  const f = t.main(dev('unknown-model'), 'unk-session-001');
  t.req(f, { model: 'acme-unknown-model', input: 100, output: 50, cacheRead: 200, cw5: 30, cw1: 0 });
  t.req(f, { model: 'claude-sonnet-5-5', input: 40, output: 10, cacheRead: 0, cwAgg: 0 });
});

define('zero-cache', 'Cache fields present as 0, and a request with no cache fields at all.', (t) => {
  const f = t.main(dev('zero-cache'), 'zero-session-001');
  t.req(f, { input: 15, output: 6, cacheRead: 0, cw5: 0, cw1: 0 });
  t.req(f, { input: 9, output: 3, noCacheFields: true });
});

define('cache-split', 'cache_creation aggregate 300 = 5m 100 + 1h 200 (split); and aggregate 300 with no split object (unsplit 300). Never double counted.', (t) => {
  const f = t.main(dev('cache-split'), 'split-session-001');
  t.req(f, { id: 'msg_split_01', input: 1, output: 1, cacheRead: 0, cw5: 100, cw1: 200, cwAgg: 300 });
  t.req(f, { id: 'msg_split_02', input: 1, output: 1, cacheRead: 0, cwAgg: 300 });
});

define('malformed-line', 'Invalid JSON line between two valid requests. Parsing continues; one warning.', (t) => {
  const f = t.main(dev('malformed-line'), 'bad-session-001');
  t.req(f, { input: 10, output: 5, cacheRead: 1, cw5: 1, cw1: 0 });
  t.malformedLine(f);
  t.req(f, { input: 20, output: 6, cacheRead: 2, cw5: 0, cw1: 1 });
});

define('partial-last-line', 'File ends with a truncated JSON line and no trailing newline. That request is NOT counted until completed.', (t) => {
  const f = t.main(dev('partial-last-line'), 'partial-session-001');
  t.req(f, { input: 10, output: 5, cacheRead: 1, cw5: 1, cw1: 0 });
  const dry = new Tree('pl');
  const tmp = dry.main('/x', 'tmp', { preamble: false });
  dry.req(tmp, { input: 99, output: 99, text: `${t.canary()} cut off` });
  const full = tmp.lines[0] as string;
  f.tail = full.slice(0, Math.floor(full.length / 2));
});

define('missing-timestamp', 'An assistant line without a timestamp key. Counted; MISSING_TIMESTAMP warning.', (t) => {
  const f = t.main(dev('missing-timestamp'), 'nots-session-001');
  t.req(f, { input: 10, output: 5, cacheRead: 1, cw5: 1, cw1: 0, ts: null });
  t.req(f, { input: 11, output: 6, cacheRead: 2, cw5: 1, cw1: 0 });
});

define('conflicting-timestamps', 'Out-of-order timestamps in one file, and a child whose requests predate the parent spawn. No negative durations allowed.', (t) => {
  const cwd = dev('conflicting-timestamps');
  const f = t.main(cwd, 'skew-session-001');
  const a = t.req(f, { input: 10, output: 5, cacheRead: 0, cwAgg: 0, ts: '2026-09-20T12:00:10.000Z', tools: [{ name: 'Agent', role: 'code-reviewer' }] });
  t.req(f, { input: 11, output: 6, cacheRead: 0, cwAgg: 0, ts: '2026-09-20T11:00:00.000Z' });
  t.req(f, { input: 12, output: 7, cacheRead: 0, cwAgg: 0, ts: '2026-09-20T12:00:05.000Z' });
  const c = t.child(cwd, 'skew-session-001', 'skew-01', { role: 'code-reviewer', toolUseId: a.toolIds[0] as string });
  t.req(c, { input: 3, output: 3, cacheRead: 0, cwAgg: 0, ts: '2026-09-19T08:00:00.000Z' });
});

define('same-named-projects', 'Two different projects whose basename is "app" (/Users/demo/a/app and /Users/demo/b/app): distinct identity.', (t) => {
  const a = t.main('/Users/demo/a/app', 'samename-a-001');
  t.req(a, { input: 10, output: 5, cacheRead: 0, cwAgg: 0 });
  const b = t.main('/Users/demo/b/app', 'samename-b-001');
  t.req(b, { input: 20, output: 6, cacheRead: 0, cwAgg: 0 });
});

define('html-payloads', 'HTML/script payloads in the cwd basename and subagent_type/agentType. Must be escaped on display.', (t) => {
  const cwd = dev(PAYLOADS.html);
  const f = t.main(cwd, 'html-session-001');
  const r = t.req(f, { input: 10, output: 5, cacheRead: 0, cwAgg: 0, tools: [{ name: 'Agent', role: PAYLOADS.html }, { name: 'Task', role: PAYLOADS.script }] });
  const c1 = t.child(cwd, 'html-session-001', 'html-01', { role: PAYLOADS.html, toolUseId: r.toolIds[0] as string });
  t.req(c1, { input: 2, output: 2, cacheRead: 0, cwAgg: 0 });
  const c2 = t.child(cwd, 'html-session-001', 'html-02', { role: PAYLOADS.script, toolUseId: r.toolIds[1] as string });
  t.req(c2, { input: 3, output: 3, cacheRead: 0, cwAgg: 0 });
});

define('formula-names', 'Project names / roles starting with = + @ - (CSV formula injection). Exports must neutralize them.', (t) => {
  PAYLOADS.formulas.forEach((name, i) => {
    const cwd = `/Users/demo/dev/formula/${name}`;
    const f = t.main(cwd, `formula-session-00${i + 1}`);
    const r = t.req(f, { input: 10 + i, output: 5, cacheRead: 0, cwAgg: 0, tools: [{ name: 'Agent', role: name }] });
    const c = t.child(cwd, `formula-session-00${i + 1}`, `formula-${i + 1}`, { role: name, toolUseId: r.toolIds[0] as string });
    t.req(c, { input: 1, output: 1, cacheRead: 0, cwAgg: 0 });
  });
});

define('same-role-children', 'Two distinct child agents with the same role (code-reviewer) stay separate by agentId.', (t) => {
  const cwd = dev('same-role-children');
  const f = t.main(cwd, 'role-session-001');
  const r = t.req(f, { input: 10, output: 5, cacheRead: 0, cwAgg: 0, tools: [{ name: 'Agent', role: 'code-reviewer' }, { name: 'Agent', role: 'code-reviewer' }] });
  for (let i = 0; i < 2; i++) {
    const c = t.child(cwd, 'role-session-001', `role-0${i + 1}`, { role: 'code-reviewer', toolUseId: r.toolIds[i] as string });
    t.req(c, { input: 4 + i, output: 4 + i, cacheRead: 0, cwAgg: 0 });
  }
});

define('shared-message-id', 'Parent and child use the identical message.id string. They are different sources, so they stay 2 requests.', (t) => {
  const cwd = dev('shared-message-id');
  const f = t.main(cwd, 'shared-session-001');
  const r = t.req(f, { id: 'msg_shared_001', input: 10, output: 5, cacheRead: 0, cwAgg: 0, tools: [{ name: 'Agent', role: 'test-runner' }] });
  const c = t.child(cwd, 'shared-session-001', 'shared-01', { role: 'test-runner', toolUseId: r.toolIds[0] as string });
  t.req(c, { id: 'msg_shared_001', input: 20, output: 9, cacheRead: 0, cwAgg: 0 });
});

const DST_EVENTS: Array<[string, string]> = [
  // America/New_York spring forward 2026-03-08 (EST->EDT at 07:00Z)
  ['2026-03-08T04:59:00.000Z', 'NY 03-07 23:59 EST'],
  ['2026-03-08T05:00:00.000Z', 'NY 03-08 00:00 EST'],
  ['2026-03-09T03:59:00.000Z', 'NY 03-08 23:59 EDT'],
  ['2026-03-09T04:00:00.000Z', 'NY 03-09 00:00 EDT'],
  // America/New_York fall back 2026-11-01 (EDT->EST at 06:00Z)
  ['2026-11-01T03:59:00.000Z', 'NY 10-31 23:59 EDT'],
  ['2026-11-01T04:00:00.000Z', 'NY 11-01 00:00 EDT'],
  ['2026-11-02T04:59:00.000Z', 'NY 11-01 23:59 EST'],
  ['2026-11-02T05:00:00.000Z', 'NY 11-02 00:00 EST'],
  // Europe/Istanbul is UTC+3 all year: local midnight = 21:00Z
  ['2026-03-07T20:59:00.000Z', 'IST 03-07 23:59'],
  ['2026-03-07T21:00:00.000Z', 'IST 03-08 00:00'],
  ['2026-11-01T20:59:00.000Z', 'IST 11-01 23:59'],
  ['2026-11-01T21:00:00.000Z', 'IST 11-02 00:00'],
];

function localDay(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

define('dst-days', 'Events one minute either side of local midnight around DST changes (America/New_York 2026-03-08, 2026-11-01) and Europe/Istanbul (no DST). `daily` holds expected per-local-day request counts.', (t) => {
  const f = t.main(dev('dst-days'), 'dst-session-001');
  DST_EVENTS.forEach(([ts], i) => t.req(f, { input: 1 + i, output: 1, cacheRead: 0, cwAgg: 0, ts }));
  const daily: Record<string, Record<string, number>> = {};
  for (const tz of ['America/New_York', 'Europe/Istanbul', 'UTC']) {
    const m: Record<string, number> = {};
    for (const [ts] of DST_EVENTS) {
      const d = localDay(ts, tz);
      m[d] = (m[d] ?? 0) + 1;
    }
    daily[tz] = m;
  }
  return daily;
});

define('legacy-task-tool', 'Legacy tool name "Task" instead of "Agent" links exactly the same way.', (t) => {
  const cwd = dev('legacy-task-tool');
  const f = t.main(cwd, 'legacy-session-001');
  const r = t.req(f, { input: 10, output: 5, cacheRead: 0, cwAgg: 0, tools: [{ name: 'Task', role: 'general-purpose' }] });
  const c = t.child(cwd, 'legacy-session-001', 'legacy-01', { role: 'general-purpose', toolUseId: r.toolIds[0] as string });
  t.req(c, { input: 4, output: 4, cacheRead: 0, cwAgg: 0 });
});

define('crlf', 'Main and child files use CRLF line endings.', (t) => {
  const cwd = dev('crlf');
  const f = t.main(cwd, 'crlf-session-001', { eol: '\r\n' });
  const r = t.req(f, { input: 10, output: 5, cacheRead: 0, cwAgg: 0, tools: [{ name: 'Agent', role: 'code-reviewer' }] });
  t.req(f, { input: 11, output: 6, cacheRead: 0, cwAgg: 0 });
  const c = t.child(cwd, 'crlf-session-001', 'crlf-01', { role: 'code-reviewer', toolUseId: r.toolIds[0] as string });
  c.eol = '\r\n';
  t.req(c, { input: 4, output: 4, cacheRead: 0, cwAgg: 0 });
});

define('prompt-injection', `Instruction-like text ("${CANARIES.injection}") in user, summary, system, assistant text and tool inputs. Must be treated as inert data.`, (t) => {
  const cwd = dev('prompt-injection');
  const f = t.main(cwd, 'inject-session-001');
  f.lines.push(JSON.stringify({ type: 'summary', summary: `${CANARIES.injection} ${t.canary()}`, leafUuid: 'leaf-inject' }));
  f.lines.push(JSON.stringify({ type: 'user', sessionId: f.sessionId, uuid: 'u-inject', timestamp: t.tick(), cwd, message: { role: 'user', content: `${CANARIES.injection}. ${t.canary()}` } }));
  t.req(f, { input: 10, output: 5, cacheRead: 0, cwAgg: 0, text: `${CANARIES.injection}. ${t.canary()}`, tools: [{ name: 'Bash' }] });
});

export const scenarios: Record<string, Scenario> = registry;

export async function writeScenario(name: string, root: string): Promise<void> {
  const s = scenarios[name];
  if (!s) throw new Error(`unknown scenario: ${name}`);
  await s.build(root);
}

export async function writeAll(root: string): Promise<void> {
  mkdirSync(root, { recursive: true });
  for (const s of Object.values(scenarios)) await s.build(root);
}

export const combinedExpected: ExpectedTotals = sumTotals(Object.values(scenarios).map((s) => s.expected));
