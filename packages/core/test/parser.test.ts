import { describe, it, expect } from 'vitest';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  dedupeSnapshots,
  mergeSnapshot,
  parseAgentMeta,
  parseJsonlLine,
  parseLine,
  parseLineDetailed,
  readAgentMeta,
  readJsonlIncrement,
  type DedupeContext,
} from '../src/parser/index.js';
import type { AssistantSnapshot, UniqueRequest } from '../src/schemas/types.js';

const FIX = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const PROJ = join(FIX, 'synthetic-home/.claude/projects/-Users-demo-dev-orbit');

function asst(over: Record<string, unknown> = {}, usage: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-09-10T10:00:00.000Z',
    message: { id: 'msg_x', model: 'm', usage: { input_tokens: 1, output_tokens: 2, ...usage } },
    ...over,
  });
}

function snap(line: string, off = 0): AssistantSnapshot {
  const r = parseLine(line, off);
  if (r.kind !== 'assistant_usage') throw new Error('not usage: ' + r.kind);
  return r.record;
}

const ctx = (kind: 'main' | 'agent', id: string): DedupeContext => ({ sourceKind: kind, sourceFileId: id, namespace: `${kind}:${id}` });

async function readSnaps(path: string): Promise<AssistantSnapshot[]> {
  const inc = await readJsonlIncrement(path, { fromOffset: 0 });
  const out: AssistantSnapshot[] = [];
  for (const l of inc.lines) {
    const r = parseJsonlLine(l).result;
    if (r.kind === 'assistant_usage') out.push(r.record);
  }
  return out;
}

describe('parseLine', () => {
  it('parses usage, ids and cache split', () => {
    const s = snap(
      asst({ requestId: 'req_1', uuid: 'u1' }, {
        cache_read_input_tokens: 7,
        cache_creation_input_tokens: 300,
        cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 },
      }),
    );
    expect(s.usage).toEqual({ uncachedInput: 1, output: 2, cacheRead: 7, cacheWrite5m: 100, cacheWrite1h: 200, unsplitCacheWrite: 0 });
    expect(s.requestId).toBe('req_1');
    expect(s.timestamp).toBe('2026-09-10T10:00:00.000Z');
  });

  it('treats aggregate with no split as unsplit', () => {
    const s = snap(asst({}, { cache_creation_input_tokens: 300 }));
    expect(s.usage.unsplitCacheWrite).toBe(300);
    expect(s.usage.cacheWrite5m + s.usage.cacheWrite1h).toBe(0);
  });

  it('computes partial unsplit remainder', () => {
    const s = snap(asst({}, { cache_creation_input_tokens: 350, cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 } }));
    expect(s.usage.unsplitCacheWrite).toBe(50);
  });

  it('warns when split exceeds aggregate and uses split only', () => {
    const d = parseLineDetailed(asst({}, { cache_creation_input_tokens: 100, cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 200 } }), 5);
    expect(d.warnings.map((w) => w.code)).toContain('CACHE_SPLIT_EXCEEDS_AGGREGATE');
    expect(d.result.kind).toBe('assistant_usage');
    if (d.result.kind === 'assistant_usage') {
      expect(d.result.record.usage.unsplitCacheWrite).toBe(0);
      expect(d.result.record.usage.cacheWrite1h).toBe(200);
    }
  });

  it('rejects negative and non-integer tokens as warnings', () => {
    const n = parseLine(asst({}, { output_tokens: -1 }), 0);
    expect(n.kind === 'warning' && n.warning.code).toBe('NEGATIVE_TOKENS');
    const f = parseLine(asst({}, { output_tokens: 1.5 }), 0);
    expect(f.kind === 'warning' && f.warning.code).toBe('NON_INTEGER_TOKENS');
  });

  it('invalid timestamp warns but keeps record with null timestamp', () => {
    const d = parseLineDetailed(asst({ timestamp: 'not a date' }), 0);
    expect(d.warnings.map((w) => w.code)).toEqual(['INVALID_TIMESTAMP']);
    expect(d.result.kind === 'assistant_usage' && d.result.record.timestamp).toBeNull();
  });

  it('normalizes timestamps to ISO UTC', () => {
    expect(snap(asst({ timestamp: '2026-09-10T12:00:00+02:00' })).timestamp).toBe('2026-09-10T10:00:00.000Z');
  });

  it('keeps only Agent/Task tool_use ids and sanitized roles, never descriptions', () => {
    const content = [
      { type: 'tool_use', id: 'toolu_a', name: 'Agent', input: { subagent_type: 'Frontend-Engineer', description: 'PRIVATE desc', prompt: 'PRIVATE prompt' } },
      { type: 'tool_use', id: 'toolu_b', name: 'Task', input: { subagent_type: 'bad role!!' } },
      { type: 'tool_use', id: 'toolu_c', name: 'Bash', input: { command: 'PRIVATE' } },
      { type: 'text', text: 'PRIVATE' },
    ];
    const s = snap(JSON.stringify({ type: 'assistant', timestamp: '2026-09-10T10:00:00Z', message: { id: 'm', usage: { input_tokens: 1, output_tokens: 1 }, content } }));
    expect(s.tasks).toEqual([
      { toolUseId: 'toolu_a', toolName: 'Agent', role: 'frontend-engineer' },
      { toolUseId: 'toolu_b', toolName: 'Task', role: null },
    ]);
    expect(JSON.stringify(s)).not.toContain('PRIVATE');
  });

  it('malformed JSON gives fixed-detail warning without source text', () => {
    const d = parseLineDetailed('{"secret": PRIVATE', 3);
    expect(d.result.kind).toBe('warning');
    expect(JSON.stringify(d)).not.toContain('PRIVATE');
    expect(d.warnings[0]?.lineOffset).toBe(3);
  });

  it('non-assistant lines return envelope; blank lines skipped', () => {
    const r = parseLine(JSON.stringify({ type: 'user', timestamp: '2026-09-10T10:00:00Z', sessionId: 's1', cwd: '/x/y', message: { content: 'PRIVATE' } }), 0);
    expect(r.kind).toBe('envelope');
    expect(JSON.stringify(r)).not.toContain('PRIVATE');
    expect(parseLine('   ', 0)).toEqual({ kind: 'skipped', reason: 'empty' });
  });
});

describe('dedupe', () => {
  it('counts 5 -> 25 streaming snapshots once with output 25', () => {
    const a = snap(asst({ timestamp: '2026-09-10T10:00:00Z' }, { output_tokens: 5 }), 0);
    const b = snap(asst({ timestamp: '2026-09-10T10:00:02Z' }, { output_tokens: 25 }), 100);
    const out = dedupeSnapshots([a, b], ctx('main', 'f1'));
    expect(out).toHaveLength(1);
    expect(out[0]?.usage.output).toBe(25);
    expect(out[0]?.snapshotCount).toBe(2);
    expect(out[0]?.firstSeenAt).toBe('2026-09-10T10:00:00.000Z');
    // order independent
    expect(dedupeSnapshots([b, a], ctx('main', 'f1'))[0]?.usage.output).toBe(25);
  });

  it('incremental merge upgrades instead of duplicating', () => {
    const c = ctx('main', 'f1');
    let req: UniqueRequest | undefined;
    req = mergeSnapshot(req, snap(asst({}, { output_tokens: 5 }), 0), c);
    req = mergeSnapshot(req, snap(asst({}, { output_tokens: 25 }), 50), c);
    req = mergeSnapshot(req, snap(asst({}, { output_tokens: 10 }), 99), c);
    expect(req.usage.output).toBe(25);
    expect(req.snapshotCount).toBe(3);
  });

  it('ties go to latest timestamp then later offset', () => {
    const early = snap(asst({ timestamp: '2026-09-10T10:00:00Z' }, { input_tokens: 1 }), 0);
    const late = snap(asst({ timestamp: '2026-09-10T10:00:05Z' }, { input_tokens: 9 }), 10);
    expect(dedupeSnapshots([late, early], ctx('main', 'f'))[0]?.usage.uncachedInput).toBe(9);
  });

  it('keeps same message.id separate across namespaces', () => {
    const s = snap(asst());
    const m = dedupeSnapshots([s], ctx('main', 'f1'))[0]!;
    const c = dedupeSnapshots([s], ctx('agent', 'f2'))[0]!;
    expect(m.dedupeKey).not.toBe(c.dedupeKey);
    expect(m.dedupeKey).toMatch(/^[0-9a-f]{64}$/);
    expect(m.dedupeQuality).toBe('exact');
  });

  it('falls back to requestId/uuid/offset as uncertain', () => {
    const noId = (extra: Record<string, unknown>, off: number) =>
      snap(JSON.stringify({ type: 'assistant', timestamp: '2026-09-10T10:00:00Z', ...extra, message: { usage: { input_tokens: 1, output_tokens: 1 } } }), off);
    const byReq = dedupeSnapshots([noId({ requestId: 'r1' }, 0), noId({ requestId: 'r1' }, 9)], ctx('main', 'f'));
    expect(byReq).toHaveLength(1);
    expect(byReq[0]?.dedupeQuality).toBe('uncertain');
    expect(dedupeSnapshots([noId({ uuid: 'u1' }, 0)], ctx('main', 'f'))[0]?.dedupeQuality).toBe('uncertain');
    expect(dedupeSnapshots([noId({}, 0), noId({}, 9)], ctx('main', 'f'))).toHaveLength(2);
  });

  it('unions task refs by toolUseId', () => {
    const mk = (id: string, off: number) =>
      snap(JSON.stringify({ type: 'assistant', timestamp: '2026-09-10T10:00:00Z', message: { id: 'm', usage: { input_tokens: 1, output_tokens: off }, content: [{ type: 'tool_use', id, name: 'Agent', input: { subagent_type: 'a' } }] } }), off);
    const out = dedupeSnapshots([mk('t1', 1), mk('t1', 2), mk('t2', 3)], ctx('main', 'f'));
    expect(out[0]?.tasks.map((t) => t.toolUseId).sort()).toEqual(['t1', 't2']);
  });
});

describe('fixtures', () => {
  it('main + child totals match README expectations', async () => {
    const mainSnaps = await readSnaps(join(PROJ, 'demo-session-001.jsonl'));
    const childSnaps = await readSnaps(join(PROJ, 'demo-session-001/subagents/agent-demo-01.jsonl'));
    const reqs = [...dedupeSnapshots(mainSnaps, ctx('main', 'm')), ...dedupeSnapshots(childSnaps, ctx('agent', 'a'))];
    expect(reqs).toHaveLength(3);
    const sum = (k: keyof UniqueRequest['usage']) => reqs.reduce((a, r) => a + r.usage[k], 0);
    expect(sum('uncachedInput')).toBe(23);
    expect(sum('output')).toBe(43);
    expect(sum('cacheRead')).toBe(80);
    expect(sum('cacheWrite5m')).toBe(52);
    expect(sum('cacheWrite1h')).toBe(0);
    expect(JSON.stringify(reqs)).not.toContain('PRIVATE');
    expect(reqs.find((r) => r.messageId === 'msg_demo_main_01')?.tasks[0]).toEqual({ toolUseId: 'toolu_demo_child_01', toolName: 'Agent', role: 'frontend-engineer' });
  });

  it('malformed line is skipped with warning and parsing continues', async () => {
    const inc = await readJsonlIncrement(join(FIX, 'malformed-example.jsonl'), { fromOffset: 0 });
    const parsed = inc.lines.map((l) => parseJsonlLine(l));
    expect(parsed.map((p) => p.result.kind)).toEqual(['assistant_usage', 'warning', 'assistant_usage']);
    expect(parsed[1]?.warnings[0]?.code).toBe('MALFORMED_JSON');
  });

  it('parses agent meta', async () => {
    const m = await readAgentMeta(join(PROJ, 'demo-session-001/subagents/agent-demo-01.meta.json'));
    expect(m).toEqual({ agentId: 'demo-01', agentType: 'frontend-engineer', toolUseId: 'toolu_demo_child_01', spawnDepth: 1 });
  });
});

describe('meta validation', () => {
  it('rejects bad types and lengths', () => {
    const m = parseAgentMeta(JSON.stringify({ agentId: 'a b', agentType: 'X'.repeat(70), toolUseId: 'x'.repeat(200), spawnDepth: 65 }));
    expect(m).toEqual({ agentId: null, agentType: null, toolUseId: null, spawnDepth: null });
    expect(parseAgentMeta('not json').agentId).toBeNull();
    expect(parseAgentMeta('[1]').agentId).toBeNull();
    expect(parseAgentMeta(JSON.stringify({ spawnDepth: 1.5 })).spawnDepth).toBeNull();
  });

  it('reader refuses files over 64 KiB', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'orbit-meta-'));
    try {
      const p = join(dir, 'big.meta.json');
      await writeFile(p, JSON.stringify({ agentId: 'a', pad: 'x'.repeat(70 * 1024) }));
      expect(await readAgentMeta(p)).toBeNull();
      expect(await readAgentMeta(join(dir, 'missing.json'))).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('readJsonlIncrement', () => {
  async function withDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(join(tmpdir(), 'orbit-jsonl-'));
    try {
      return await fn(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('does not emit partial trailing line until newline appended', async () => {
    await withDir(async (dir) => {
      const p = join(dir, 'a.jsonl');
      const l1 = asst({}, { output_tokens: 1 });
      const l2 = asst({}, { output_tokens: 2 });
      await writeFile(p, l1 + '\n' + l2.slice(0, 20));
      const a = await readJsonlIncrement(p, { fromOffset: 0 });
      expect(a.lines).toHaveLength(1);
      expect(a.partialTrailing).toBe(true);
      expect(a.nextOffset).toBe(Buffer.byteLength(l1) + 1);
      await appendFile(p, l2.slice(20) + '\n');
      const b = await readJsonlIncrement(p, { fromOffset: a.nextOffset });
      expect(b.lines).toHaveLength(1);
      expect(b.lines[0]?.offset).toBe(a.nextOffset);
      expect(b.partialTrailing).toBe(false);
      expect(parseLine(b.lines[0]!.text, 0).kind).toBe('assistant_usage');
    });
  });

  it('handles CRLF and multi-byte offsets', async () => {
    await withDir(async (dir) => {
      const p = join(dir, 'c.jsonl');
      await writeFile(p, '{"type":"user","x":"é"}\r\n{"type":"user"}\r\n');
      const r = await readJsonlIncrement(p, { fromOffset: 0 });
      expect(r.lines.map((l) => l.text)).toEqual(['{"type":"user","x":"é"}', '{"type":"user"}']);
      expect(r.lines[1]?.offset).toBe(Buffer.byteLength('{"type":"user","x":"é"}\r\n'));
    });
  });

  it('flags invalid UTF-8 and skips over-long lines without buffering', async () => {
    await withDir(async (dir) => {
      const p = join(dir, 'u.jsonl');
      await writeFile(p, Buffer.concat([Buffer.from('{"a":"'), Buffer.from([0xff, 0xfe]), Buffer.from('"}\n'), Buffer.from('x'.repeat(5000) + '\n'), Buffer.from('{"ok":1}\n')]));
      const r = await readJsonlIncrement(p, { fromOffset: 0, maxLineBytes: 1000 });
      expect(r.lines).toHaveLength(3);
      expect(r.lines[0]?.invalidUtf8).toBe(true);
      expect(parseJsonlLine(r.lines[0]!).warnings.map((w) => w.code)).toContain('INVALID_UTF8');
      expect(r.lines[1]).toMatchObject({ tooLong: true, text: '' });
      expect(parseJsonlLine(r.lines[1]!).warnings[0]?.code).toBe('LINE_TOO_LONG');
      expect(r.lines[2]?.text).toBe('{"ok":1}');
    });
  });

  it('reports truncation and honors maxBytes', async () => {
    await withDir(async (dir) => {
      const p = join(dir, 't.jsonl');
      await writeFile(p, '{"a":1}\n{"a":2}\n');
      const t = await readJsonlIncrement(p, { fromOffset: 999 });
      expect(t.truncated).toBe(true);
      const m = await readJsonlIncrement(p, { fromOffset: 0, maxBytes: 10 });
      expect(m.lines).toHaveLength(1);
      expect(m.partialTrailing).toBe(true);
      expect(m.fileIdentity.size).toBe(16);
    });
  });
});
