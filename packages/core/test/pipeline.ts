import { discoverSources, type DiscoveredSource } from '../src/discovery/index.js';
import { dedupeSnapshots, namespaceFor, parseJsonlLine, readAgentMeta, readJsonlIncrement } from '../src/parser/index.js';
import { linkAgents, type ChildAgent, type ParentTaskRef } from '../src/attribution/index.js';
import { getDefaultSchedule, resolveRate } from '../src/cost/index.js';
import type { AgentLink, AssistantSnapshot, ParseWarningCode, TokenUsage, UniqueRequest } from '../src/schemas/types.js';

export interface PipelineResult {
  sources: DiscoveredSource[];
  requests: UniqueRequest[];
  links: AgentLink[];
  warnings: Partial<Record<ParseWarningCode, number>>;
  usage: TokenUsage;
  unknownModelRequests: number;
  projects: number;
  sessions: number;
  bytes: number;
}

/** Full core pipeline without a database: discovery -> read -> parse -> dedupe -> link -> rate resolution. */
export async function runPipeline(root: string): Promise<PipelineResult> {
  const { sources } = await discoverSources(root);
  const schedule = getDefaultSchedule();
  const requests: UniqueRequest[] = [];
  const refs: ParentTaskRef[] = [];
  const agents: ChildAgent[] = [];
  const warnings: Partial<Record<ParseWarningCode, number>> = {};
  let bytes = 0;

  for (const src of sources) {
    bytes += src.size;
    const inc = await readJsonlIncrement(src.localPath, { fromOffset: 0 });
    const snaps: AssistantSnapshot[] = [];
    for (const line of inc.lines) {
      const { result, warnings: ws } = parseJsonlLine(line);
      for (const w of ws) warnings[w.code] = (warnings[w.code] ?? 0) + 1;
      if (result.kind === 'assistant_usage') snaps.push(result.record);
    }
    const reqs = dedupeSnapshots(snaps, {
      sourceKind: src.kind,
      sourceFileId: src.sourceFileId,
      namespace: namespaceFor(src.kind, src.sourceFileId),
    });
    for (const r of reqs) {
      requests.push(r);
      for (const t of r.tasks) refs.push({ ...t, sessionId: src.sessionId, parentAgentId: src.agentId });
    }
    if (src.kind === 'agent') {
      const meta = src.metaLocalPath ? await readAgentMeta(src.metaLocalPath) : null;
      agents.push({ agentId: src.agentId, sessionId: src.sessionId, meta, underSessionDir: true });
    }
  }

  const links = linkAgents(refs, agents);
  const usage: TokenUsage = { uncachedInput: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, unsplitCacheWrite: 0 };
  let unknownModelRequests = 0;
  for (const r of requests) {
    for (const k of Object.keys(usage) as (keyof TokenUsage)[]) usage[k] += r.usage[k];
    if (!resolveRate(schedule, r.model, r.timestamp).ok) unknownModelRequests++;
  }
  const mains = sources.filter((s) => s.kind === 'main');
  return {
    sources,
    requests,
    links,
    warnings,
    usage,
    unknownModelRequests,
    projects: new Set(sources.map((s) => s.projectDirName)).size,
    sessions: mains.length,
    bytes,
  };
}
