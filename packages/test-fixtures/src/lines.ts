/** JSONL line builders shared by the generator and the append helpers. */

export type UsageOpts = {
  input: number;
  output: number;
  cacheRead?: number;
  /** Aggregate cache_creation_input_tokens. Defaults to cacheWrite5m + cacheWrite1h when a split is given. */
  cacheWriteAgg?: number;
  cacheWrite5m?: number;
  cacheWrite1h?: number;
  /** Omit all cache fields (older shapes). */
  omitCacheFields?: boolean;
};

export type ToolUseOpt = { id: string; name: string; input: Record<string, unknown> };

export type AssistantLineOpts = {
  sessionId: string;
  uuid: string;
  /** undefined/null => the key is omitted entirely. */
  timestamp?: string | null;
  cwd?: string;
  agentId?: string;
  messageId: string;
  requestId?: string;
  model: string;
  usage: UsageOpts;
  tools?: ToolUseOpt[];
  text?: string;
  stopReason?: string | null;
  version?: string;
};

export type ResolvedCache = { agg: number; c5: number; c1: number; unsplit: number; hasSplit: boolean };

export function resolveCache(u: UsageOpts): ResolvedCache {
  if (u.omitCacheFields) return { agg: 0, c5: 0, c1: 0, unsplit: 0, hasSplit: false };
  const hasSplit = u.cacheWrite5m !== undefined || u.cacheWrite1h !== undefined;
  const c5 = u.cacheWrite5m ?? 0;
  const c1 = u.cacheWrite1h ?? 0;
  const agg = u.cacheWriteAgg ?? (hasSplit ? c5 + c1 : 0);
  return { agg, c5, c1, unsplit: hasSplit ? Math.max(0, agg - c5 - c1) : agg, hasSplit };
}

export function assistantLine(o: AssistantLineOpts): string {
  const c = resolveCache(o.usage);
  const usage: Record<string, unknown> = {
    input_tokens: o.usage.input,
    output_tokens: o.usage.output,
  };
  if (!o.usage.omitCacheFields) {
    usage.cache_read_input_tokens = o.usage.cacheRead ?? 0;
    usage.cache_creation_input_tokens = c.agg;
    if (c.hasSplit) {
      usage.cache_creation = { ephemeral_5m_input_tokens: c.c5, ephemeral_1h_input_tokens: c.c1 };
    }
  }
  usage.service_tier = 'standard';
  const content: unknown[] = [];
  if (o.text !== undefined) content.push({ type: 'text', text: o.text });
  for (const t of o.tools ?? []) content.push({ type: 'tool_use', id: t.id, name: t.name, input: t.input });
  const message: Record<string, unknown> = { id: o.messageId, type: 'message', role: 'assistant', model: o.model };
  if (o.stopReason !== undefined) message.stop_reason = o.stopReason;
  message.usage = usage;
  message.content = content;
  const line: Record<string, unknown> = { type: 'assistant', sessionId: o.sessionId, uuid: o.uuid };
  if (o.timestamp) line.timestamp = o.timestamp;
  if (o.cwd !== undefined) line.cwd = o.cwd;
  if (o.agentId !== undefined) {
    line.agentId = o.agentId;
    line.isSidechain = true;
  }
  if (o.requestId !== undefined) line.requestId = o.requestId;
  line.version = o.version ?? '2.1.0';
  line.message = message;
  return JSON.stringify(line);
}

export function userLine(o: { sessionId: string; uuid: string; timestamp: string; cwd?: string; text: string }): string {
  const line: Record<string, unknown> = { type: 'user', sessionId: o.sessionId, uuid: o.uuid, timestamp: o.timestamp };
  if (o.cwd !== undefined) line.cwd = o.cwd;
  line.message = { role: 'user', content: o.text };
  return JSON.stringify(line);
}

export function systemLine(o: { sessionId: string; uuid: string; timestamp: string; cwd?: string; text: string }): string {
  const line: Record<string, unknown> = { type: 'system', sessionId: o.sessionId, uuid: o.uuid, timestamp: o.timestamp };
  if (o.cwd !== undefined) line.cwd = o.cwd;
  line.content = o.text;
  line.level = 'info';
  return JSON.stringify(line);
}

export function summaryLine(o: { text: string; leafUuid: string }): string {
  return JSON.stringify({ type: 'summary', summary: o.text, leafUuid: o.leafUuid });
}
