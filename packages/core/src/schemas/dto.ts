/**
 * HTTP DTO contract v1 (server <-> web). Implements docs/API_CONTRACTS.md with
 * the concrete shapes agreed in ADR-002. All timestamps ISO-8601 UTC. Money is
 * a 6-decimal USD string ("estimated API-equivalent value"), never a number.
 * No DTO may contain absolute paths, prompt/output text or task descriptions.
 */
import type {
  AgentStatus,
  CostSummary,
  LinkConfidence,
  Quality,
  RateCard,
  RateEntry,
  TokenUsage,
} from './types.js';

export type DatasetMode = 'real' | 'demo' | 'none';

export interface Metric<T> {
  value: T;
  quality: Quality;
  /** i18n reason key, e.g. 'reason.observedUsage'. */
  reason?: string;
}

export interface TokenTotals extends TokenUsage {
  /** Sum of all six categories ("processed tokens"). */
  processed: number;
}

export interface Period {
  from: string;
  to: string;
  /** IANA timezone used for day bucketing. */
  tz: string;
}

export interface Coverage {
  sourceFirstAt: string | null;
  sourceLastAt: string | null;
  uniqueRequests: number;
  unpricedRequestCount: number;
  fallbackPricedRequestCount: number;
  unlinkedAgentCount: number;
  malformedLineCount: number;
  /** Requests retained in Orbit's archive whose source file is gone. */
  archivedOnlyRequestCount: number;
  sourceStatus: 'complete' | 'partial' | 'empty' | 'not_scanned';
}

export interface ApiError {
  error: {
    code:
      | 'SOURCE_NOT_FOUND'
      | 'PERMISSION_DENIED'
      | 'SCAN_IN_PROGRESS'
      | 'PARTIAL_TRANSCRIPT'
      | 'RATE_NOT_FOUND'
      | 'UNSUPPORTED_SOURCE_SCHEMA'
      | 'INVALID_FILTER'
      | 'EXPORT_TOO_LARGE'
      | 'APP_ARCHIVE_NOT_INITIALIZED'
      | 'NO_COVERAGE'
      | 'CROSS_ORIGIN_DENIED'
      | 'CSRF_REQUIRED'
      | 'CONSENT_REQUIRED'
      | 'SOURCE_NOT_ALLOWED'
      | 'NOT_FOUND'
      | 'RATE_LIMITED'
      | 'INTERNAL';
    message: string;
    retryable: boolean;
  };
}

/* ---------- session / status ---------- */

export interface SessionInfo {
  csrfToken: string;
  version: string;
}

export type WatcherState = 'watching' | 'polling' | 'off' | 'error';

export interface ScanState {
  state: 'idle' | 'scanning' | 'error';
  startedAt: string | null;
  finishedAt: string | null;
  filesTotal: number;
  filesDone: number;
  lastError: ApiError['error']['code'] | null;
}

export interface StatusDTO {
  mode: DatasetMode;
  consentGranted: boolean;
  /** e.g. "~/.claude/projects" (home redacted to ~) */
  sourceLabel: string | null;
  archiveEnabled: boolean;
  scan: ScanState;
  watcher: WatcherState;
  lastScanAt: string | null;
  revision: number;
  version: string;
}

/* ---------- shared rows ---------- */

export interface ModelSlice {
  modelId: string;
  displayName: string | null;
  requests: number;
  tokens: TokenTotals;
  usdDecimal: string | null;
  priced: boolean;
}

export interface DailyPoint {
  /** Local calendar date (YYYY-MM-DD) in Period.tz. */
  date: string;
  uniqueRequests: number;
  tokens: TokenTotals;
  usdDecimal: string;
  unpricedRequests: number;
  sessions: number;
}

export interface ProjectSummary {
  id: string;
  /** User alias (Orbit DB only) if set. */
  alias: string | null;
  /** Sanitized basename of cwd (or opaque fallback). Render as text only. */
  label: string;
  /** Short opaque code to tell same-named projects apart. */
  shortCode: string;
  nameCollision: boolean;
  sessions: number;
  requests: number;
  agents: number;
  tokens: TokenTotals;
  usdDecimal: string;
  unpricedRequests: number;
  lastActiveAt: string | null;
  /** processed tokens per day for the last 14 local days of the period */
  trend: number[];
  sourcePresent: boolean;
}

export interface SessionSummary {
  id: string;
  shortId: string;
  projectId: string;
  projectLabel: string;
  firstAt: string | null;
  lastAt: string | null;
  observedSpanMs: Metric<number | null>;
  requests: number;
  models: string[];
  subagentCount: number;
  tokens: TokenTotals;
  usdDecimal: string;
  unpricedRequests: number;
  sourcePresent: boolean;
}

export interface AgentSummary {
  id: string;
  shortId: string;
  /** sanitized role slug or null ("role hidden/unknown") */
  role: string | null;
  projectId: string | null;
  projectLabel: string | null;
  sessionId: string | null;
  parentAgentId: string | null;
  depth: number | null;
  confidence: LinkConfidence;
  linkReason: string;
  status: AgentStatus;
  firstAt: string | null;
  lastAt: string | null;
  requests: number;
  models: string[];
  tokens: TokenTotals;
  usdDecimal: string;
  unpricedRequests: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  nextCursor: string | null;
}

export type InsightKind =
  | 'most_active_project'
  | 'cache_read_share'
  | 'delegation_share'
  | 'busiest_day'
  | 'unpriced_warning'
  | 'model_leader';

export interface Insight {
  id: string;
  kind: InsightKind;
  /** values interpolated into the i18n template `insight.<kind>` */
  params: Record<string, string | number>;
  /** in-app route proving the number, e.g. "/projects/p_abc" */
  evidenceHref: string;
}

/* ---------- endpoints ---------- */

export interface OverviewDTO {
  mode: DatasetMode;
  period: Period;
  asOf: string;
  revision: number;
  kpis: {
    uniqueRequests: Metric<number>;
    tokens: TokenTotals & { quality: Quality };
    cost: CostSummary;
    sessions: Metric<number>;
    projects: Metric<number>;
    subagents: Metric<number>;
  };
  /** Same-length previous period, for deltas; null if no data before. */
  previous: { uniqueRequests: number; processedTokens: number; usdDecimal: string; sessions: number; requestCoverage: number } | null;
  daily: DailyPoint[];
  models: ModelSlice[];
  topProjects: ProjectSummary[];
  /** Agent role activity by local hour-of-day (24 buckets) for lanes. */
  agentLanes: { role: string | null; invocations: number; hourly: number[] }[];
  insights: Insight[];
  coverage: Coverage;
}

export interface ProjectDetailDTO {
  project: ProjectSummary;
  period: Period;
  daily: DailyPoint[];
  models: ModelSlice[];
  sessions: SessionSummary[];
  agents: AgentSummary[];
  attribution: { main: TokenTotals & { usdDecimal: string; requests: number }; agents: TokenTotals & { usdDecimal: string; requests: number } };
  coverage: Coverage;
}

export interface RequestPoint {
  t: string;
  kind: 'main' | 'agent';
  agentId: string | null;
  model: string | null;
  processed: number;
  output: number;
  usdDecimal: string | null;
}

export interface SessionDetailDTO {
  session: SessionSummary;
  models: ModelSlice[];
  agents: AgentSummary[];
  /** Chronological unique requests (max 1000; truncated flag). */
  requests: RequestPoint[];
  truncated: boolean;
  attribution: ProjectDetailDTO['attribution'];
  coverage: Coverage;
}

export interface AgentGraphNode {
  id: string;
  kind: 'session' | 'agent';
  label: string;
  role: string | null;
  projectId: string | null;
  processed: number;
  status: AgentStatus | null;
  orphan: boolean;
}

export interface AgentGraphEdge {
  from: string;
  to: string;
  confidence: LinkConfidence;
}

export interface AgentsDTO extends Page<AgentSummary> {
  period: Period;
  graph: { nodes: AgentGraphNode[]; edges: AgentGraphEdge[]; truncated: boolean };
  totals: { byConfidence: Record<LinkConfidence, number>; byStatus: Record<AgentStatus, number>; tokens: TokenTotals; usdDecimal: string };
  roles: string[];
}

export interface AgentDetailDTO {
  agent: AgentSummary;
  parentSession: SessionSummary | null;
  parentAgent: AgentSummary | null;
  children: AgentSummary[];
  requests: RequestPoint[];
  truncated: boolean;
  evidence: { confidence: LinkConfidence; reason: string; toolUseIdMatched: boolean };
}

export interface TimelineInterval {
  start: string;
  end: string;
  sessionId: string;
  agentId: string | null;
  requests: number;
  processed: number;
}

export interface TimelineDTO {
  period: Period;
  groupBy: 'project' | 'agent';
  lanes: { id: string; label: string; kind: 'project' | 'agent'; intervals: TimelineInterval[] }[];
  /** true when intervals were merged/limited to stay under the cap */
  truncated: boolean;
}

export interface CostsDTO {
  period: Period;
  cost: CostSummary;
  byModel: (ModelSlice & { rate: RateCard | null; rateSource: 'official' | 'user_override' | null })[];
  byCategory: Record<keyof TokenUsage, { tokens: number; usdDecimal: string }>;
  daily: DailyPoint[];
  unpriced: { modelId: string; requests: number; tokens: number }[];
  schedule: { version: string; sourceUrl: string; lastVerified: string; notModeled: string[]; overrideCount: number };
}

export interface StoryDTO {
  period: Period;
  mode: DatasetMode;
  overview: Pick<OverviewDTO, 'kpis' | 'daily' | 'models' | 'topProjects' | 'coverage' | 'insights'>;
  delegation: { mainRequests: number; agentRequests: number; agentShare: number; topRoles: { role: string | null; requests: number }[]; byConfidence: Record<LinkConfidence, number> };
  cache: { cacheReadShare: number; cacheWriteShare: number; uncachedInputShare: number };
  schedule: CostsDTO['schedule'];
}

export interface DiagnosticsDTO {
  lastScan: { startedAt: string | null; finishedAt: string | null; durationMs: number | null; filesScanned: number; filesSkipped: number; bytesRead: number };
  warningsByCode: Record<string, number>;
  discovery: { symlinksSkipped: number; oversizeSkipped: number; ignoredFiles: number; unreadable: number };
  orphanAgents: number;
  unpricedRequests: number;
  unpricedModels: string[];
  watcher: WatcherState;
  dbSizeBytes: number;
  schemaVersion: number;
}

export interface SettingsDTO {
  consentGranted: boolean;
  sourceLabel: string | null;
  sourceIsDefault: boolean;
  archiveEnabled: boolean;
  watchIntervalMs: number;
  locale: 'tr' | 'en';
  timezone: string;
  activeDataset: DatasetMode;
  rateOverrides: RateEntry[];
  dataDirLabel: string;
}

/** PATCH /api/v1/settings body (all optional). `sourceRoot` is the only path ever accepted (body only). */
export interface SettingsPatch {
  consentGranted?: boolean;
  sourceRoot?: string | 'default';
  archiveEnabled?: boolean;
  watchIntervalMs?: number;
  locale?: 'tr' | 'en';
  timezone?: string;
  activeDataset?: 'real' | 'demo';
  rateOverrides?: RateEntry[];
}

/** Export columns (allowlist). */
export const EXPORT_COLUMNS = [
  'date',
  'project_id',
  'project_label',
  'model',
  'requests',
  'uncached_input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_write_5m_tokens',
  'cache_write_1h_tokens',
  'unsplit_cache_write_tokens',
  'estimated_api_equivalent_usd',
  'price_quality',
] as const;

export interface ExportMeta {
  source_mode: 'local_claude_code' | 'synthetic_demo';
  estimate_type: 'api_price_equivalent';
  disclaimer: string;
  rate_schedule_version: string;
  unknown_priced_requests: number;
  excluded_unknown_models: string[];
  coverage_window: { from: string | null; to: string | null };
  period: Period;
  generated_at: string;
  columns: readonly string[];
}

/** SSE event names on /api/v1/events. Payloads carry only revision + opaque ids. */
export type SseEvent =
  | { event: 'scan.updated'; data: { revision: number; state: ScanState['state'] } }
  | { event: 'usage.updated'; data: { revision: number; changedProjects: string[] } }
  | { event: 'diagnostics.updated'; data: { revision: number } };
