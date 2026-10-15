import type {
  AssistantSnapshot,
  EnvelopeInfo,
  ParsedLine,
  ParseWarning,
  ParseWarningCode,
  TaskInvocationRef,
  TokenUsage,
} from '../schemas/types.js';
import { isSafeId, safeCwd, safeId, safeModelId, safeType, safeVersion, sanitizeRoleSlug } from './sanitize.js';

export const MAX_LINE_BYTES = 4 * 1024 * 1024;

export interface ParseLineDetailed {
  result: ParsedLine;
  warnings: ParseWarning[];
}

const DETAIL: Record<ParseWarningCode, string> = {
  MALFORMED_JSON: 'Line is not valid JSON',
  LINE_TOO_LONG: 'Line exceeds maximum length',
  INVALID_TIMESTAMP: 'Timestamp is missing a valid ISO date',
  MISSING_TIMESTAMP: 'Record has no timestamp',
  NEGATIVE_TOKENS: 'Token counter is negative',
  NON_INTEGER_TOKENS: 'Token counter is not a safe integer',
  MISSING_MESSAGE_ID: 'Assistant record has no message id',
  UNSUPPORTED_SHAPE: 'Record shape is not supported',
  INVALID_UTF8: 'Line contains invalid UTF-8',
  CLOCK_SKEW: 'Timestamps are out of order',
  CACHE_SPLIT_EXCEEDS_AGGREGATE: 'Cache write split exceeds aggregate',
};

export function makeWarning(code: ParseWarningCode, lineOffset: number): ParseWarning {
  return { code, lineOffset, detail: DETAIL[code] };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

type Counter = { ok: true; value: number } | { ok: false; code: 'NEGATIVE_TOKENS' | 'NON_INTEGER_TOKENS' | 'UNSUPPORTED_SHAPE' };

function counter(v: unknown): Counter {
  if (v === undefined || v === null) return { ok: true, value: 0 };
  if (typeof v !== 'number' || Number.isNaN(v)) return { ok: false, code: 'UNSUPPORTED_SHAPE' };
  if (v < 0) return { ok: false, code: 'NEGATIVE_TOKENS' };
  if (!Number.isSafeInteger(v)) return { ok: false, code: 'NON_INTEGER_TOKENS' };
  return { ok: true, value: v };
}

function normTimestamp(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > 64) return null;
  const ms = Date.parse(v);
  if (Number.isNaN(ms)) return null;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

function extractTasks(content: unknown): TaskInvocationRef[] {
  if (!Array.isArray(content)) return [];
  const out: TaskInvocationRef[] = [];
  for (const item of content) {
    if (!isObj(item) || item['type'] !== 'tool_use') continue;
    const name = item['name'];
    if (name !== 'Agent' && name !== 'Task') continue;
    if (!isSafeId(item['id'])) continue;
    const input = item['input'];
    const role = isObj(input) ? sanitizeRoleSlug(input['subagent_type']) : null;
    out.push({ toolUseId: item['id'], toolName: name, role });
  }
  return out;
}

/** Full-detail parse: the result plus every warning raised while parsing. */
export function parseLineDetailed(line: string, lineOffset: number): ParseLineDetailed {
  const fail = (code: ParseWarningCode): ParseLineDetailed => {
    const warning = makeWarning(code, lineOffset);
    return { result: { kind: 'warning', warning }, warnings: [warning] };
  };

  if (line.trim().length === 0) return { result: { kind: 'skipped', reason: 'empty' }, warnings: [] };
  if (line.length > MAX_LINE_BYTES) return fail('LINE_TOO_LONG');

  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return fail('MALFORMED_JSON');
  }
  if (!isObj(raw)) return fail('UNSUPPORTED_SHAPE');

  const warnings: ParseWarning[] = [];
  const warn = (code: ParseWarningCode) => warnings.push(makeWarning(code, lineOffset));

  const timestamp = normTimestamp(raw['timestamp']);
  if (timestamp === null) warn(raw['timestamp'] === undefined ? 'MISSING_TIMESTAMP' : 'INVALID_TIMESTAMP');

  const envelope: EnvelopeInfo = {
    type: safeType(raw['type']),
    timestamp,
    sessionId: safeId(raw['sessionId']),
    agentId: safeId(raw['agentId']),
    cwd: safeCwd(raw['cwd']),
    version: safeVersion(raw['version']),
  };

  if (envelope.type !== 'assistant') {
    return { result: { kind: 'envelope', record: envelope }, warnings };
  }

  const message = raw['message'];
  const usage = isObj(message) ? message['usage'] : undefined;
  if (!isObj(message) || !isObj(usage)) {
    // Assistant line without usage: still useful for span/cwd.
    return { result: { kind: 'envelope', record: envelope }, warnings };
  }

  const cc = usage['cache_creation'];
  const fields = {
    input: counter(usage['input_tokens']),
    output: counter(usage['output_tokens']),
    cacheRead: counter(usage['cache_read_input_tokens']),
    cacheAgg: counter(usage['cache_creation_input_tokens']),
    w5: counter(isObj(cc) ? cc['ephemeral_5m_input_tokens'] : undefined),
    w1: counter(isObj(cc) ? cc['ephemeral_1h_input_tokens'] : undefined),
  };
  for (const f of Object.values(fields)) {
    if (!f.ok) return fail(f.code);
  }
  // all ok past this point
  const v = (c: Counter): number => (c.ok ? c.value : 0);
  const agg = v(fields.cacheAgg);
  const w5 = v(fields.w5);
  const w1 = v(fields.w1);
  const split = w5 + w1;
  if (!Number.isSafeInteger(split)) return fail('NON_INTEGER_TOKENS');
  let unsplit = Math.max(0, agg - split);
  if (split > agg) {
    // Use split values only; never charge both.
    warn('CACHE_SPLIT_EXCEEDS_AGGREGATE');
    unsplit = 0;
  }

  const tokenUsage: TokenUsage = {
    uncachedInput: v(fields.input),
    output: v(fields.output),
    cacheRead: v(fields.cacheRead),
    cacheWrite5m: w5,
    cacheWrite1h: w1,
    unsplitCacheWrite: unsplit,
  };

  const messageId = safeId(message['id']);
  if (messageId === null) warn('MISSING_MESSAGE_ID');

  const record: AssistantSnapshot = {
    ...envelope,
    uuid: safeId(raw['uuid']),
    requestId: safeId(raw['requestId']),
    messageId,
    model: safeModelId(message['model']),
    stopReason: typeof message['stop_reason'] === 'string' ? sanitizeRoleSlug(message['stop_reason']) : null,
    usage: tokenUsage,
    cacheCreationAggregate: agg,
    tasks: extractTasks(message['content']),
    lineOffset,
  };
  return { result: { kind: 'assistant_usage', record }, warnings };
}

export function parseLine(line: string, lineOffset: number): ParsedLine {
  return parseLineDetailed(line, lineOffset).result;
}
