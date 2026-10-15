import type { AgentLink, AgentMeta, TaskInvocationRef } from '../schemas/types.js';

export const MAX_AGENT_DEPTH = 64;

/** A task invocation seen in a parent transcript (main file, or another agent's file). */
export interface ParentTaskRef extends TaskInvocationRef {
  sessionId: string;
  /** Set when the Agent/Task tool_use was itself emitted inside a subagent file. */
  parentAgentId: string | null;
}

export interface ChildAgent {
  agentId: string | null;
  /** From directory/envelope. */
  sessionId: string | null;
  meta: AgentMeta | null;
  /** File lives under <session>/subagents/. */
  underSessionDir: boolean;
}

function unlinked(agentId: string, a: ChildAgent, reason: string): AgentLink {
  return {
    agentId,
    parentSessionId: a.sessionId,
    parentToolUseId: null,
    parentAgentId: null,
    role: a.meta?.agentType ?? null,
    depth: null,
    confidence: 'unlinked',
    reason,
  };
}

export function linkAgents(refs: readonly ParentTaskRef[], agents: readonly ChildAgent[]): AgentLink[] {
  const refKey = (s: string, t: string) => `${s}\0${t}`;
  const refByKey = new Map<string, ParentTaskRef>();
  for (const r of refs) refByKey.set(refKey(r.sessionId, r.toolUseId), r);

  const links: (AgentLink | null)[] = agents.map(() => null);
  const claimed = new Map<string, number[]>(); // refKey -> agent indexes (exact claimants)

  // Pass 1: exact claims.
  agents.forEach((a, i) => {
    if (!a.agentId) {
      links[i] = {
        agentId: '',
        parentSessionId: a.sessionId,
        parentToolUseId: null,
        parentAgentId: null,
        role: null,
        depth: null,
        confidence: 'unknown',
        reason: 'no_agent_id',
      };
      return;
    }
    const tu = a.meta?.toolUseId ?? null;
    if (tu && a.sessionId && refByKey.has(refKey(a.sessionId, tu))) {
      const k = refKey(a.sessionId, tu);
      claimed.set(k, [...(claimed.get(k) ?? []), i]);
    }
  });

  const exactRefKeys = new Set<string>();
  for (const [k, idxs] of claimed) {
    if (idxs.length > 1) {
      for (const i of idxs) links[i] = unlinked(agents[i]!.agentId!, agents[i]!, 'tool_use_id_claimed_by_multiple');
      exactRefKeys.add(k); // still consumed: never offer to inference
      continue;
    }
    const i = idxs[0]!;
    const a = agents[i]!;
    const ref = refByKey.get(k)!;
    links[i] = {
      agentId: a.agentId!,
      parentSessionId: ref.sessionId,
      parentToolUseId: ref.toolUseId,
      parentAgentId: ref.parentAgentId,
      role: a.meta?.agentType ?? ref.role,
      depth: null,
      confidence: 'exact',
      reason: 'meta_tool_use_id_match',
    };
    exactRefKeys.add(k);
  }

  // Pass 2: inference by session dir + unique role, only for agents without meta toolUseId.
  const pending = agents
    .map((a, i) => ({ a, i }))
    .filter(({ a, i }) => links[i] === null && a.agentId && !a.meta?.toolUseId);
  for (const { a, i } of pending) {
    const role = a.meta?.agentType ?? null;
    if (!a.underSessionDir || !a.sessionId || !role) {
      links[i] = unlinked(a.agentId!, a, 'no_parent_evidence');
      continue;
    }
    const candRefs = refs.filter(
      (r) => r.sessionId === a.sessionId && r.role === role && !exactRefKeys.has(refKey(r.sessionId, r.toolUseId)),
    );
    const sameRoleChildren = pending.filter(
      (p) => p.a.sessionId === a.sessionId && p.a.underSessionDir && (p.a.meta?.agentType ?? null) === role,
    );
    if (candRefs.length === 1 && sameRoleChildren.length === 1) {
      const ref = candRefs[0]!;
      links[i] = {
        agentId: a.agentId!,
        parentSessionId: ref.sessionId,
        parentToolUseId: ref.toolUseId,
        parentAgentId: ref.parentAgentId,
        role,
        depth: null,
        confidence: 'inferred',
        reason: 'session_dir_role_unique',
      };
    } else if (candRefs.length === 0) {
      links[i] = unlinked(a.agentId!, a, 'no_parent_evidence');
    } else {
      links[i] = unlinked(a.agentId!, a, 'ambiguous_role_match');
    }
  }

  // Remaining agents with a meta toolUseId that matched nothing.
  agents.forEach((a, i) => {
    if (links[i] === null) links[i] = unlinked(a.agentId!, a, 'tool_use_id_not_found');
  });

  const result = links as AgentLink[];

  // Depth + cycle detection over parentAgentId chains (keyed by agentId, last wins on duplicates).
  const byAgent = new Map<string, number>();
  result.forEach((l, i) => {
    if (l.agentId) byAgent.set(l.agentId, i);
  });
  const depthOf = (start: number): { depth: number | null; bad: string | null } => {
    let depth = 1;
    const seen = new Set<string>([result[start]!.agentId]);
    let cur = result[start]!;
    while (cur.parentAgentId) {
      if (seen.has(cur.parentAgentId)) return { depth: null, bad: 'cycle_detected' };
      seen.add(cur.parentAgentId);
      const pi = byAgent.get(cur.parentAgentId);
      depth += 1;
      if (depth > MAX_AGENT_DEPTH) return { depth: null, bad: 'depth_exceeded' };
      if (pi === undefined) return { depth: null, bad: null }; // parent agent not in set: depth unknown
      cur = result[pi]!;
    }
    return { depth, bad: null };
  };
  // Evaluate against the unmodified link graph, then apply, so results are order independent.
  const verdicts = result.map((l, i) =>
    l.confidence === 'exact' || l.confidence === 'inferred' ? depthOf(i) : null,
  );
  return result.map((l, i) => {
    const v = verdicts[i];
    if (!v) return l;
    if (v.bad) {
      return { ...l, parentToolUseId: null, parentAgentId: null, depth: null, confidence: 'unlinked' as const, reason: v.bad };
    }
    return { ...l, depth: v.depth ?? agents[i]!.meta?.spawnDepth ?? null };
  });
}
