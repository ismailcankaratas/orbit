import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkAgents, type ChildAgent, type ParentTaskRef } from '../src/attribution/index.js';
import { dedupeSnapshots, parseJsonlLine, readAgentMeta, readJsonlIncrement } from '../src/parser/index.js';
import type { AgentMeta, AssistantSnapshot } from '../src/schemas/types.js';

const PROJ = join(fileURLToPath(new URL('../../../fixtures/', import.meta.url)), 'synthetic-home/.claude/projects/-Users-demo-dev-orbit');

const meta = (o: Partial<AgentMeta>): AgentMeta => ({ agentId: null, agentType: null, toolUseId: null, spawnDepth: null, ...o });
const ref = (toolUseId: string, role: string | null, sessionId = 's1', parentAgentId: string | null = null): ParentTaskRef => ({ toolUseId, toolName: 'Agent', role, sessionId, parentAgentId });
const child = (agentId: string | null, m: Partial<AgentMeta> | null, sessionId = 's1', under = true): ChildAgent => ({ agentId, sessionId, meta: m ? meta(m) : null, underSessionDir: under });

describe('linkAgents', () => {
  it('links the fixture agent exactly', async () => {
    const inc = await readJsonlIncrement(join(PROJ, 'demo-session-001.jsonl'), { fromOffset: 0 });
    const snaps: AssistantSnapshot[] = [];
    for (const l of inc.lines) {
      const r = parseJsonlLine(l).result;
      if (r.kind === 'assistant_usage') snaps.push(r.record);
    }
    const reqs = dedupeSnapshots(snaps, { sourceKind: 'main', sourceFileId: 'm', namespace: 'main:m' });
    const refs: ParentTaskRef[] = reqs.flatMap((r) => r.tasks.map((t) => ({ ...t, sessionId: 'demo-session-001', parentAgentId: null })));
    const m = await readAgentMeta(join(PROJ, 'demo-session-001/subagents/agent-demo-01.meta.json'));
    const links = linkAgents(refs, [{ agentId: 'demo-01', sessionId: 'demo-session-001', meta: m, underSessionDir: true }]);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      agentId: 'demo-01',
      parentToolUseId: 'toolu_demo_child_01',
      confidence: 'exact',
      reason: 'meta_tool_use_id_match',
      role: 'frontend-engineer',
      depth: 1,
    });
    expect(JSON.stringify(links)).not.toContain('PRIVATE');
  });

  it('infers by unique role in session dir when meta has no toolUseId', () => {
    const [l] = linkAgents([ref('t1', 'qa')], [child('a1', { agentType: 'qa' })]);
    expect(l).toMatchObject({ confidence: 'inferred', reason: 'session_dir_role_unique', parentToolUseId: 't1' });
  });

  it('two children with the same role are not linked to one ref', () => {
    const links = linkAgents([ref('t1', 'qa')], [child('a1', { agentType: 'qa' }), child('a2', { agentType: 'qa' })]);
    expect(links.map((l) => l.confidence)).toEqual(['unlinked', 'unlinked']);
    expect(links[0]?.parentToolUseId).toBeNull();
  });

  it('two exact children with the same role stay separate', () => {
    const links = linkAgents(
      [ref('t1', 'qa'), ref('t2', 'qa')],
      [child('a1', { agentType: 'qa', toolUseId: 't1' }), child('a2', { agentType: 'qa', toolUseId: 't2' })],
    );
    expect(links.map((l) => [l.agentId, l.parentToolUseId, l.confidence])).toEqual([
      ['a1', 't1', 'exact'],
      ['a2', 't2', 'exact'],
    ]);
  });

  it('does not infer on same-role ambiguity or across sessions', () => {
    const amb = linkAgents([ref('t1', 'qa'), ref('t2', 'qa')], [child('a1', { agentType: 'qa' })]);
    expect(amb[0]).toMatchObject({ confidence: 'unlinked', reason: 'ambiguous_role_match' });
    const other = linkAgents([ref('t1', 'qa', 'other')], [child('a1', { agentType: 'qa' })]);
    expect(other[0]?.confidence).toBe('unlinked');
  });

  it('orphan child is unlinked; unknown when no agentId', () => {
    const [o] = linkAgents([], [child('a1', { agentType: 'qa', toolUseId: 'nope' })]);
    expect(o).toMatchObject({ confidence: 'unlinked', reason: 'tool_use_id_not_found' });
    const [n] = linkAgents([ref('t1', 'qa')], [child(null, null)]);
    expect(n?.confidence).toBe('unknown');
    const [p] = linkAgents([ref('t1', 'qa')], [child('a9', null, 's1', false)]);
    expect(p).toMatchObject({ confidence: 'unlinked', reason: 'no_parent_evidence' });
  });

  it('supports nested agents with depth', () => {
    const links = linkAgents(
      [ref('t1', 'lead'), ref('t2', 'qa', 's1', 'a1')],
      [child('a1', { toolUseId: 't1', agentType: 'lead' }), child('a2', { toolUseId: 't2', agentType: 'qa' })],
    );
    expect(links[1]).toMatchObject({ parentAgentId: 'a1', depth: 2, confidence: 'exact' });
  });

  it('detects cycles', () => {
    const links = linkAgents(
      [ref('t1', 'x', 's1', 'a2'), ref('t2', 'y', 's1', 'a1')],
      [child('a1', { toolUseId: 't1' }), child('a2', { toolUseId: 't2' })],
    );
    expect(links.map((l) => [l.confidence, l.reason])).toEqual([
      ['unlinked', 'cycle_detected'],
      ['unlinked', 'cycle_detected'],
    ]);
  });

  it('rejects chains deeper than 64', () => {
    const refs: ParentTaskRef[] = [];
    const kids: ChildAgent[] = [];
    for (let i = 0; i < 70; i++) {
      refs.push(ref(`t${i}`, 'r', 's1', i === 0 ? null : `a${i - 1}`));
      kids.push(child(`a${i}`, { toolUseId: `t${i}` }));
    }
    const links = linkAgents(refs, kids);
    expect(links[0]?.depth).toBe(1);
    expect(links[63]?.depth).toBe(64);
    expect(links[69]).toMatchObject({ confidence: 'unlinked', reason: 'depth_exceeded' });
  });
});
