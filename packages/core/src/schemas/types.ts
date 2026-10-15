/**
 * Orbit normalized data contract (ADR-001). Shared by parser, attribution,
 * cost engine, server repository and web DTOs.
 *
 * PRIVACY: none of these types may carry prompt text, tool inputs, model output,
 * task descriptions or absolute filesystem paths. `localPath` fields exist only
 * on server-internal source records and must never be serialized to HTTP/exports.
 */

export type Quality = 'observed' | 'derived' | 'estimated' | 'unknown';

export type LinkConfidence = 'exact' | 'inferred' | 'unlinked' | 'unknown';

export type AgentStatus = 'observed_recently' | 'historical' | 'unknown' | 'completed_recorded';

export type SourceKind = 'main' | 'agent';

/** Token counters for one unique API response (all non-negative integers). */
export interface TokenUsage {
  uncachedInput: number;
  output: number;
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  /** cache_creation_input_tokens not explained by the 5m/1h split. */
  unsplitCacheWrite: number;
}

export const ZERO_USAGE: Readonly<TokenUsage> = Object.freeze({
  uncachedInput: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite5m: 0,
  cacheWrite1h: 0,
  unsplitCacheWrite: 0,
});

/** Agent/Task tool_use spotted in a parent assistant message. */
export interface TaskInvocationRef {
  toolUseId: string;
  /** 'Agent' | 'Task' (tool name). */
  toolName: string;
  /** Sanitized subagent_type role slug (e.g. "frontend-engineer"), max 64 chars [a-z0-9._-]. Never the description. */
  role: string | null;
}

/** Result of parsing one JSONL line. */
export type ParsedLine =
  | { kind: 'assistant_usage'; record: AssistantSnapshot }
  | { kind: 'envelope'; record: EnvelopeInfo }
  | { kind: 'skipped'; reason: 'not_assistant' | 'no_usage' | 'empty' }
  | { kind: 'warning'; warning: ParseWarning };

/** Safe envelope metadata from any line type (used for session spans/cwd). */
export interface EnvelopeInfo {
  type: string;
  timestamp: string | null; // ISO UTC
  sessionId: string | null;
  agentId: string | null;
  /** Raw cwd — server-internal only, used for project identity. */
  cwd: string | null;
  version: string | null;
}

/** One assistant snapshot (possibly a streaming duplicate). */
export interface AssistantSnapshot extends EnvelopeInfo {
  uuid: string | null;
  requestId: string | null;
  messageId: string | null;
  model: string | null;
  stopReason: string | null;
  usage: TokenUsage;
  /** Raw cache_creation_input_tokens aggregate as reported (for diagnostics). */
  cacheCreationAggregate: number;
  tasks: TaskInvocationRef[];
  /** byte offset of the line within its file (internal provenance). */
  lineOffset: number;
}

export type ParseWarningCode =
  | 'MALFORMED_JSON'
  | 'LINE_TOO_LONG'
  | 'INVALID_TIMESTAMP'
  | 'MISSING_TIMESTAMP'
  | 'NEGATIVE_TOKENS'
  | 'NON_INTEGER_TOKENS'
  | 'MISSING_MESSAGE_ID'
  | 'UNSUPPORTED_SHAPE'
  | 'INVALID_UTF8'
  | 'CLOCK_SKEW'
  | 'CACHE_SPLIT_EXCEEDS_AGGREGATE';

export interface ParseWarning {
  code: ParseWarningCode;
  lineOffset: number;
  /** Short fixed explanation. NEVER contains source text. */
  detail: string;
}

/** A deduplicated unique API request, ready for attribution and pricing. */
export interface UniqueRequest {
  /** sha256 hex of namespace + message id (ADR-001 §6). */
  dedupeKey: string;
  dedupeQuality: 'exact' | 'uncertain';
  sourceKind: SourceKind;
  /** Opaque source file id (hash), never a path. */
  sourceFileId: string;
  sessionId: string | null;
  agentId: string | null;
  messageId: string | null;
  requestId: string | null;
  model: string | null;
  timestamp: string | null; // ISO UTC of the selected final snapshot
  firstSeenAt: string | null;
  usage: TokenUsage;
  snapshotCount: number;
  stopReason: string | null;
  tasks: TaskInvocationRef[];
}

/** Subagent metadata from agent-*.meta.json (validated). */
export interface AgentMeta {
  agentId: string | null;
  agentType: string | null; // sanitized role slug
  toolUseId: string | null;
  spawnDepth: number | null;
}

export interface AgentLink {
  agentId: string;
  parentSessionId: string | null;
  parentToolUseId: string | null;
  parentAgentId: string | null;
  role: string | null;
  depth: number | null;
  confidence: LinkConfidence;
  /** Fixed-vocabulary reason code, e.g. 'meta_tool_use_id_match'. */
  reason: string;
}

/* ---------------- Pricing ---------------- */

/** USD per million tokens, as decimal strings (exact). */
export interface RateCard {
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite5m: string;
  cacheWrite1h: string;
}

export interface RateEntry {
  modelId: string;
  displayName: string;
  /** Additional exact IDs/aliases that resolve to this entry. */
  aliases: string[];
  effectiveFrom: string; // ISO
  effectiveTo: string | null; // ISO, exclusive
  rates: RateCard;
  /** Optional higher tier when a single request's prompt (input+cache read+cache writes) exceeds threshold. */
  longPromptTier?: { thresholdTokens: number; rates: RateCard };
  source: 'official' | 'user_override';
}

export interface RateSchedule {
  version: string;
  sourceUrl: string;
  lastVerified: string; // ISO date
  currency: 'USD';
  notModeled: string[];
  entries: RateEntry[];
}

export type PriceQuality = 'priced' | 'estimated_fallback' | 'unpriced';

export interface PricedRequest {
  dedupeKey: string;
  /** Raw model id as observed (for unpriced-model reporting). */
  model: string | null;
  /** integer micro-USD; null when unpriced. */
  microUsd: bigint | null;
  priceQuality: PriceQuality;
  rateModelId: string | null;
  rateScheduleVersion: string;
  unpricedReason: 'unknown_model' | 'missing_model' | 'no_rate_for_time' | null;
}

export interface CostSummary {
  /** decimal USD string with 6 fractional digits, e.g. "0.042100" */
  usdDecimal: string;
  quality: 'estimated';
  reason: string;
  rateScheduleVersion: string;
  pricedRequestCount: number;
  fallbackPricedRequestCount: number;
  unpricedRequestCount: number;
  unpricedTokens: number;
  unpricedModels: string[];
  /** 0..1 share of requests priced. */
  requestCoverage: number;
  /** 0..1 share of processed tokens priced. */
  tokenCoverage: number;
}
