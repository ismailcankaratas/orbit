import {
  RATE_SCALE,
  formatMicroUsd,
  parseRate,
  resolveRate,
  roundHalfUp,
  type AgentDetailDTO,
  type AgentGraphEdge,
  type AgentGraphNode,
  type AgentStatus,
  type AgentSummary,
  type AgentsDTO,
  type CostsDTO,
  type Coverage,
  type DailyPoint,
  type DiagnosticsDTO,
  type Insight,
  type LinkConfidence,
  type ModelSlice,
  type OverviewDTO,
  type Page,
  type ProjectDetailDTO,
  type ProjectSummary,
  type RequestPoint,
  type SessionDetailDTO,
  type SessionSummary,
  type StoryDTO,
  type TimelineDTO,
  type TimelineInterval,
  type TokenTotals,
  type TokenUsage,
} from '@orbit/core';
import type { Store } from '../db/index.js';
import type { Runtime } from '../runtime.js';
import { HttpError } from '../errors.js';
import { sourceSql, type SourceRange } from '../db/rollup.js';
import { AGG_SQL, AGG_X, EMPTY_AGG, PROCESSED_SQL, PROCESSED_X, costSummaryOf, processedOf, splitModels, tokensOf, usdOf, type Agg } from './agg.js';
import {
  DAY_MS,
  MISSING_MODEL,
  addDays,
  buildWhere,
  dateRange,
  localDate,
  localHour,
  paginate,
  periodOf,
  type Filters,
} from './filters.js';

const BUCKET_MS = 900_000;
const RECENT_MS = 10 * 60_000;
const GAP_MS = 15 * 60_000;
const MAX_INTERVALS = 5000;
const MAX_GRAPH_NODES = 300;
const MAX_POINTS = 1000;
const ALL_TIME: Pick<Filters, 'fromMs' | 'toMs'> = { fromMs: 0, toMs: 253_402_300_799_000 };

type Src = { sql: string; params: (string | number)[] };

interface ProjectMetaRow {
  id: string;
  label: string;
  alias: string | null;
  short_code: string;
  coll: number;
  present: number;
}

const shortIdOf = (id: string): string => id.replace(/^[a-z]_/, '').slice(0, 8);
const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

export class Queries {
  constructor(private readonly rt: Runtime) {}

  private get store(): Store {
    return this.rt.store();
  }

  private now(): number {
    return this.rt.clock();
  }

  /* ---------- low-level aggregates ---------- */

  /** Rollup-shaped rows for the filter's period (rollup + exact edge rows, or per-request rows when disabled/dirty). */
  private src(f: Pick<Filters, 'fromMs' | 'toMs' | 'projectId' | 'modelId'> | SourceRange): Src {
    const s = sourceSql(this.store, f, this.rt.rollupEnabled, MISSING_MODEL);
    return { sql: s.sql, params: s.params };
  }

  private agg(f: Filters): Agg {
    const s = this.src(f);
    return this.store.get<Agg>(`SELECT ${AGG_X} FROM (${s.sql}) x`, ...s.params) ?? EMPTY_AGG;
  }

  private unpricedModels(f: Filters): string[] {
    const s = this.src(f);
    return this.store
      .all<{ m: string | null }>(`SELECT DISTINCT x.model AS m FROM (${s.sql}) x WHERE x.unpriced > 0 ORDER BY m`, ...s.params)
      .map((x) => x.m ?? MISSING_MODEL);
  }

  private cost(f: Filters, a: Agg) {
    return costSummaryOf(a, this.rt.schedule(), a.unpriced > 0 ? this.unpricedModels(f) : []);
  }

  private projectMeta(ids: string[]): Map<string, ProjectMetaRow> {
    const out = new Map<string, ProjectMetaRow>();
    if (ids.length === 0) return out;
    for (let i = 0; i < ids.length; i += 400) {
      const chunk = ids.slice(i, i + 400);
      const rows = this.store.all<ProjectMetaRow>(
        `SELECT p.id, p.label, p.alias, p.short_code,
           (SELECT COUNT(*) FROM projects p2 WHERE p2.label = p.label AND p2.id <> p.id) AS coll,
           EXISTS (SELECT 1 FROM sessions s WHERE s.project_id = p.id AND s.present = 1) AS present
         FROM projects p WHERE p.id IN (${chunk.map(() => '?').join(',')})`,
        ...chunk,
      );
      for (const r of rows) out.set(r.id, r);
    }
    return out;
  }

  private displayLabel(m: ProjectMetaRow | undefined): string | null {
    return m ? (m.alias && m.alias.length > 0 ? m.alias : m.label) : null;
  }

  /* ---------- daily ---------- */

  dailyBuckets(f: Filters): Map<string, Agg & { sessions: number }> {
    const w = this.src(f);
    const rows = this.store.all<Agg & { b: number }>(
      `SELECT x.bucket AS b, ${AGG_X} FROM (${w.sql}) x GROUP BY b`,
      ...w.params,
    );
    const sess = this.store.all<{ b: number; s: string }>(
      `SELECT x.bucket AS b, x.session_id AS s FROM (${w.sql}) x GROUP BY b, s`,
      ...w.params,
    );
    const by = new Map<string, Agg & { sessions: number }>();
    const sets = new Map<string, Set<string>>();
    for (const r of rows) {
      const d = localDate(r.b * BUCKET_MS, f.tz);
      let cur = by.get(d);
      if (!cur) {
        cur = { ...EMPTY_AGG, sessions: 0 };
        by.set(d, cur);
      }
      cur.n += r.n; cur.ui += r.ui; cur.o += r.o; cur.cr += r.cr; cur.c5 += r.c5; cur.c1 += r.c1; cur.us += r.us;
      cur.usd += r.usd; cur.unpriced += r.unpriced; cur.fb += r.fb; cur.unpriced_tok += r.unpriced_tok;
    }
    for (const r of sess) {
      const d = localDate(r.b * BUCKET_MS, f.tz);
      let s = sets.get(d);
      if (!s) {
        s = new Set();
        sets.set(d, s);
      }
      s.add(r.s);
    }
    for (const [d, s] of sets) {
      const cur = by.get(d);
      if (cur) cur.sessions = s.size;
    }
    return by;
  }

  daily(f: Filters): DailyPoint[] {
    const by = this.dailyBuckets(f);
    const startDay = localDate(f.fromMs, f.tz);
    const endDay = localDate(f.toMs - 1, f.tz);
    let days: string[];
    if ((f.toMs - f.fromMs) / DAY_MS <= 400) days = dateRange(startDay, endDay);
    else {
      const keys = [...by.keys()].sort();
      days = keys.length === 0 ? [] : dateRange(keys[0] as string, keys[keys.length - 1] as string);
    }
    return days.map((date) => {
      const a = by.get(date) ?? { ...EMPTY_AGG, sessions: 0 };
      return {
        date,
        uniqueRequests: a.n,
        tokens: tokensOf(a),
        usdDecimal: usdOf(a),
        unpricedRequests: a.unpriced,
        sessions: a.sessions,
      };
    });
  }

  /* ---------- models ---------- */

  models(f: Filters): ModelSlice[] {
    const w = this.src(f);
    const schedule = this.rt.schedule();
    const rows = this.store.all<Agg & { model: string | null }>(
      `SELECT x.model AS model, ${AGG_X} FROM (${w.sql}) x GROUP BY x.model`,
      ...w.params,
    );
    return rows
      .map((r) => {
        const res = resolveRate(schedule, r.model, null);
        const priced = r.n - r.unpriced > 0;
        return {
          modelId: r.model ?? MISSING_MODEL,
          displayName: res.ok ? res.entry.displayName : null,
          requests: r.n,
          tokens: tokensOf(r),
          usdDecimal: priced ? usdOf(r) : null,
          priced,
        };
      })
      .sort((a, b) => b.tokens.processed - a.tokens.processed || (a.modelId < b.modelId ? -1 : 1));
  }

  /* ---------- coverage ---------- */

  coverage(f: Filters, a?: Agg): Coverage {
    const agg = a ?? this.agg(f);
    const w = this.src(f);
    const span = this.store.get<{ lo: number | null; hi: number | null; arch: number }>(
      `SELECT MIN(x.tmin) AS lo, MAX(x.tmax) AS hi, COALESCE(SUM(x.arch), 0) AS arch FROM (${w.sql}) x`,
      ...w.params,
    );
    const unlinked = this.store.get<{ c: number }>(
      f.projectId
        ? "SELECT COUNT(*) AS c FROM agents WHERE confidence IN ('unlinked','unknown') AND project_id = ?"
        : "SELECT COUNT(*) AS c FROM agents WHERE confidence IN ('unlinked','unknown')",
      ...(f.projectId ? [f.projectId] : []),
    )?.c ?? 0;
    const malformed = this.store.get<{ c: number }>("SELECT COALESCE(SUM(count), 0) AS c FROM parse_warnings WHERE code = 'MALFORMED_JSON'")?.c ?? 0;
    const diag = this.rt.lastScan()?.discovery;
    let status: Coverage['sourceStatus'];
    if (!this.rt.hasScanned()) status = 'not_scanned';
    else if (agg.n === 0) status = 'empty';
    else if (malformed > 0 || (diag && (diag.unreadable > 0 || diag.oversizeSkipped > 0)) || (span?.arch ?? 0) > 0) status = 'partial';
    else status = 'complete';
    return {
      sourceFirstAt: iso(span?.lo ?? null),
      sourceLastAt: iso(span?.hi ?? null),
      uniqueRequests: agg.n,
      unpricedRequestCount: agg.unpriced,
      fallbackPricedRequestCount: agg.fb,
      unlinkedAgentCount: unlinked,
      malformedLineCount: malformed,
      archivedOnlyRequestCount: span?.arch ?? 0,
      sourceStatus: status,
    };
  }

  /* ---------- projects ---------- */

  private projectAggRows(f: Filters, sort: string): (Agg & { id: string; sessions: number; agents: number; last: number | null })[] {
    const w = this.src(f);
    const orderExpr =
      sort === 'cost'
        ? 'g.usd DESC'
        : sort === 'requests'
          ? 'g.n DESC'
          : sort === 'recent'
            ? 'g.last DESC'
            : sort === 'label'
              ? 'p.label COLLATE NOCASE ASC'
              : '(g.ui + g.o + g.cr + g.c5 + g.c1 + g.us) DESC';
    return this.store.all(
      `SELECT g.* FROM (
         SELECT x.project_id AS id, COUNT(DISTINCT x.session_id) AS sessions, COUNT(DISTINCT x.agent_id) AS agents,
                MAX(x.tmax) AS last, ${AGG_X}
         FROM (${w.sql}) x WHERE x.project_id IS NOT NULL GROUP BY x.project_id
       ) g LEFT JOIN projects p ON p.id = g.id ORDER BY ${orderExpr}, g.id`,
      ...w.params,
    );
  }

  private trend(f: Filters, ids: string[]): Map<string, number[]> {
    const out = new Map<string, number[]>();
    if (ids.length === 0) return out;
    const endDay = localDate(f.toMs - 1, f.tz);
    const days = dateRange(addDays(endDay, -13), endDay);
    const idx = new Map(days.map((d, i) => [d, i]));
    for (const id of ids) out.set(id, new Array<number>(14).fill(0));
    const lo = Math.max(f.fromMs, f.toMs - 16 * DAY_MS);
    for (let i = 0; i < ids.length; i += 400) {
      const chunk = ids.slice(i, i + 400);
      const s = this.src({ fromMs: lo, toMs: f.toMs, projectIds: chunk });
      const rows = this.store.all<{ pid: string; b: number; t: number }>(
        `SELECT x.project_id AS pid, x.bucket AS b, SUM${PROCESSED_X} AS t FROM (${s.sql}) x GROUP BY pid, b`,
        ...s.params,
      );
      for (const r of rows) {
        const k = idx.get(localDate(r.b * BUCKET_MS, f.tz));
        const arr = out.get(r.pid);
        if (k !== undefined && arr) arr[k] = (arr[k] ?? 0) + r.t;
      }
    }
    return out;
  }

  private toProjectSummaries(f: Filters, rows: ReturnType<Queries['projectAggRows']>): ProjectSummary[] {
    const ids = rows.map((r) => r.id);
    const meta = this.projectMeta(ids);
    const trend = this.trend(f, ids);
    return rows.map((r) => {
      const m = meta.get(r.id);
      return {
        id: r.id,
        alias: m?.alias ?? null,
        label: m?.label ?? 'project-' + r.id.slice(2, 6),
        shortCode: m?.short_code ?? r.id.slice(2, 6),
        nameCollision: (m?.coll ?? 0) > 0,
        sessions: r.sessions,
        requests: r.n,
        agents: r.agents,
        tokens: tokensOf(r),
        usdDecimal: usdOf(r),
        unpricedRequests: r.unpriced,
        lastActiveAt: iso(r.last),
        trend: trend.get(r.id) ?? new Array<number>(14).fill(0),
        sourcePresent: (m?.present ?? 1) === 1,
      };
    });
  }

  projects(f: Filters, sort: string, limit: number, cursor: string | undefined): Page<ProjectSummary> {
    const rows = this.projectAggRows(f, sort);
    const p = paginate(rows, limit, cursor, sort);
    return { items: this.toProjectSummaries(f, p.items), total: p.total, nextCursor: p.nextCursor };
  }

  projectSummary(id: string, f: Filters): ProjectSummary | null {
    const exists = this.projectMeta([id]).has(id);
    if (!exists) return null;
    const rows = this.projectAggRows({ ...f, projectId: id }, 'tokens');
    const row = rows[0] ?? { ...EMPTY_AGG, id, sessions: 0, agents: 0, last: null };
    return (this.toProjectSummaries(f, [row as never]))[0] ?? null;
  }

  private attribution(f: Filters, sessionId?: string) {
    const get = (cond: 'main' | 'agent'): Agg & { usdS: string } => {
      const isMain = cond === 'main';
      let a: Agg | undefined;
      if (sessionId) {
        // Single session: the session index on `requests` beats scanning rollup rows.
        const w = buildWhere(f);
        a = this.store.get<Agg>(
          `SELECT ${AGG_SQL} FROM requests r WHERE ${w.sql} AND r.session_id = ? AND r.agent_id IS ${isMain ? '' : 'NOT '}NULL`,
          ...w.params, sessionId,
        );
      } else {
        const s = this.src(f);
        a = this.store.get<Agg>(`SELECT ${AGG_X} FROM (${s.sql}) x WHERE x.agent_id IS ${isMain ? '' : 'NOT '}NULL`, ...s.params);
      }
      const v = a ?? EMPTY_AGG;
      return { ...v, usdS: usdOf(v) };
    };
    const m = get('main');
    const a = get('agent');
    return {
      main: { ...tokensOf(m), usdDecimal: m.usdS, requests: m.n },
      agents: { ...tokensOf(a), usdDecimal: a.usdS, requests: a.n },
    };
  }

  projectDetail(id: string, f0: Filters): ProjectDetailDTO {
    const f = { ...f0, projectId: id };
    const summary = this.projectSummary(id, f);
    if (!summary) throw new HttpError(404, 'NOT_FOUND', 'Project not found.');
    const a = this.agg(f);
    return {
      project: summary,
      period: periodOf(f),
      daily: this.daily(f),
      models: this.models(f),
      sessions: this.sessionRows(f).slice(0, 50),
      agents: this.agentSummaries(f).slice(0, 50),
      attribution: this.attribution(f),
      coverage: this.coverage(f, a),
    };
  }

  /* ---------- sessions ---------- */

  private sessionRows(f: Filters, onlyId?: string): SessionSummary[] {
    const w = buildWhere(f);
    const rows = this.store.all<
      Agg & { id: string; project_id: string | null; first_ms: number | null; last_ms: number | null; present: number | null; agents: number; models: string | null }
    >(
      `SELECT r.session_id AS id, s.project_id AS project_id, s.first_ms AS first_ms, s.last_ms AS last_ms, s.present AS present,
              COUNT(DISTINCT r.agent_id) AS agents, GROUP_CONCAT(DISTINCT r.model) AS models, ${AGG_SQL}
       FROM requests r LEFT JOIN sessions s ON s.id = r.session_id
       WHERE ${w.sql}${onlyId ? ' AND r.session_id = ?' : ''}
       GROUP BY r.session_id ORDER BY s.last_ms DESC, r.session_id`,
      ...w.params, ...(onlyId ? [onlyId] : []),
    );
    const meta = this.projectMeta([...new Set(rows.map((r) => r.project_id).filter((x): x is string => !!x))]);
    return rows.map((r) => {
      const span = r.first_ms !== null && r.last_ms !== null && r.last_ms >= r.first_ms ? r.last_ms - r.first_ms : null;
      return {
        id: r.id,
        shortId: shortIdOf(r.id),
        projectId: r.project_id ?? '',
        projectLabel: this.displayLabel(r.project_id ? meta.get(r.project_id) : undefined) ?? '',
        firstAt: iso(r.first_ms),
        lastAt: iso(r.last_ms),
        observedSpanMs: { value: span, quality: 'estimated', reason: 'reason.observedSpan' },
        requests: r.n,
        models: splitModels(r.models),
        subagentCount: r.agents,
        tokens: tokensOf(r),
        usdDecimal: usdOf(r),
        unpricedRequests: r.unpriced,
        sourcePresent: (r.present ?? 1) === 1,
      };
    });
  }

  sessions(f: Filters, limit: number, cursor: string | undefined): Page<SessionSummary> {
    return paginate(this.sessionRows(f), limit, cursor, 'recent');
  }

  sessionDetail(id: string, tz: string): SessionDetailDTO {
    const f: Filters = { ...ALL_TIME, tz, projectId: null, modelId: null };
    const session = this.sessionRows(f, id)[0];
    if (!session) throw new HttpError(404, 'NOT_FOUND', 'Session not found.');
    const w = buildWhere(f);
    const a = this.store.get<Agg>(`SELECT ${AGG_SQL} FROM requests r WHERE ${w.sql} AND r.session_id = ?`, ...w.params, id) ?? EMPTY_AGG;
    const { points, truncated } = this.requestPoints(`r.session_id = ?`, [id]);
    return {
      session,
      models: this.modelsWhere(f, 'r.session_id = ?', [id]),
      agents: this.agentSummaries(f, { sessionId: id }),
      requests: points,
      truncated,
      attribution: this.attribution(f, id),
      coverage: { ...this.coverage({ ...f, projectId: session.projectId || null }, a), uniqueRequests: a.n },
    };
  }

  private modelsWhere(f: Filters, extraSql: string, extraParams: (string | number)[]): ModelSlice[] {
    const w = buildWhere(f);
    const schedule = this.rt.schedule();
    const rows = this.store.all<Agg & { model: string | null }>(
      `SELECT r.model AS model, ${AGG_SQL} FROM requests r WHERE ${w.sql} AND ${extraSql} GROUP BY r.model`,
      ...w.params, ...extraParams,
    );
    return rows
      .map((r) => {
        const res = resolveRate(schedule, r.model, null);
        const priced = r.n - r.unpriced > 0;
        return {
          modelId: r.model ?? MISSING_MODEL,
          displayName: res.ok ? res.entry.displayName : null,
          requests: r.n,
          tokens: tokensOf(r),
          usdDecimal: priced ? usdOf(r) : null,
          priced,
        };
      })
      .sort((a, b) => b.tokens.processed - a.tokens.processed || (a.modelId < b.modelId ? -1 : 1));
  }

  private requestPoints(cond: string, params: (string | number)[]): { points: RequestPoint[]; truncated: boolean } {
    const rows = this.store.all<{
      ts_ms: number | null;
      agent_id: string | null;
      model: string | null;
      processed: number;
      output: number;
      micro_usd: number | null;
    }>(
      `SELECT r.ts_ms, r.agent_id, r.model, ${PROCESSED_SQL} AS processed, r.output, r.micro_usd
       FROM requests r WHERE ${cond} ORDER BY r.ts_ms, r.dedupe_key LIMIT ${MAX_POINTS + 1}`,
      ...params,
    );
    return {
      truncated: rows.length > MAX_POINTS,
      points: rows.slice(0, MAX_POINTS).map((r) => ({
        t: iso(r.ts_ms) ?? '',
        kind: r.agent_id ? ('agent' as const) : ('main' as const),
        agentId: r.agent_id,
        model: r.model,
        processed: r.processed,
        output: r.output,
        usdDecimal: r.micro_usd === null ? null : formatMicroUsd(BigInt(r.micro_usd)),
      })),
    };
  }

  /* ---------- agents ---------- */

  private statusOf(lastMs: number | null): AgentStatus {
    if (lastMs === null) return 'unknown';
    return this.now() - lastMs <= RECENT_MS ? 'observed_recently' : 'historical';
  }

  private agentSummaries(
    f: Filters,
    extra: { role?: string; confidence?: string; sessionId?: string; agentId?: string; parentId?: string } = {},
  ): AgentSummary[] {
    const w = buildWhere(f);
    const conds: string[] = [];
    const params: (string | number)[] = [];
    if (extra.role) { conds.push('a.role = ?'); params.push(extra.role); }
    if (extra.confidence) { conds.push('a.confidence = ?'); params.push(extra.confidence); }
    if (extra.sessionId) { conds.push('a.session_id = ?'); params.push(extra.sessionId); }
    if (extra.agentId) { conds.push('a.id = ?'); params.push(extra.agentId); }
    if (extra.parentId) { conds.push('a.parent_agent_id = ?'); params.push(extra.parentId); }
    const rows = this.store.all<
      Agg & {
        id: string; role: string | null; project_id: string | null; session_id: string; parent_agent_id: string | null;
        depth: number | null; confidence: LinkConfidence; reason: string; first_ms: number | null; last_ms: number | null; models: string | null;
      }
    >(
      `SELECT a.id, a.role, a.project_id, a.session_id, a.parent_agent_id, a.depth, a.confidence, a.reason, a.first_ms, a.last_ms,
              GROUP_CONCAT(DISTINCT r.model) AS models, ${AGG_SQL}
       FROM agents a JOIN requests r ON r.agent_id = a.id
       WHERE ${w.sql}${conds.length ? ' AND ' + conds.join(' AND ') : ''}
       GROUP BY a.id ORDER BY (SUM(r.uncached_input + r.output + r.cache_read + r.cache_write_5m + r.cache_write_1h + r.unsplit_cache_write)) DESC, a.id`,
      ...w.params, ...params,
    );
    const meta = this.projectMeta([...new Set(rows.map((r) => r.project_id).filter((x): x is string => !!x))]);
    return rows.map((r) => ({
      id: r.id,
      shortId: shortIdOf(r.id),
      role: r.role,
      projectId: r.project_id,
      projectLabel: this.displayLabel(r.project_id ? meta.get(r.project_id) : undefined),
      sessionId: r.session_id,
      parentAgentId: r.parent_agent_id,
      depth: r.depth,
      confidence: r.confidence,
      linkReason: r.reason,
      status: this.statusOf(r.last_ms),
      firstAt: iso(r.first_ms),
      lastAt: iso(r.last_ms),
      requests: r.n,
      models: splitModels(r.models),
      tokens: tokensOf(r),
      usdDecimal: usdOf(r),
      unpricedRequests: r.unpriced,
    }));
  }

  agents(
    f: Filters,
    q: { role?: string; confidence?: string; sessionId?: string },
    limit: number,
    cursor: string | undefined,
  ): AgentsDTO {
    const all = this.agentSummaries(f, q);
    const page = paginate(all, limit, cursor, 'tokens');
    const byConfidence: Record<LinkConfidence, number> = { exact: 0, inferred: 0, unlinked: 0, unknown: 0 };
    const byStatus: Record<AgentStatus, number> = { observed_recently: 0, historical: 0, unknown: 0, completed_recorded: 0 };
    const tot: Agg = { ...EMPTY_AGG };
    for (const a of all) {
      byConfidence[a.confidence] += 1;
      byStatus[a.status] += 1;
      tot.ui += a.tokens.uncachedInput; tot.o += a.tokens.output; tot.cr += a.tokens.cacheRead;
      tot.c5 += a.tokens.cacheWrite5m; tot.c1 += a.tokens.cacheWrite1h; tot.us += a.tokens.unsplitCacheWrite;
    }
    // graph
    const nodes: AgentGraphNode[] = [];
    const edges: AgentGraphEdge[] = [];
    const nodeIds = new Set<string>();
    let truncated = false;
    const sessionLabels = new Map<string, { label: string; projectId: string | null }>();
    const top = all.slice(0, MAX_GRAPH_NODES);
    if (all.length > top.length) truncated = true;
    const agentIds = new Set(top.map((a) => a.id));
    const w = buildWhere(f);
    const mainProcessed = new Map<string, number>();
    const sessionIds = [...new Set(top.map((a) => a.sessionId).filter((x): x is string => !!x))];
    for (let i = 0; i < sessionIds.length; i += 400) {
      const chunk = sessionIds.slice(i, i + 400);
      const rows = this.store.all<{ s: string; t: number }>(
        `SELECT r.session_id AS s, SUM${PROCESSED_SQL} AS t FROM requests r WHERE ${w.sql} AND r.agent_id IS NULL AND r.session_id IN (${chunk.map(() => '?').join(',')}) GROUP BY r.session_id`,
        ...w.params, ...chunk,
      );
      for (const r of rows) mainProcessed.set(r.s, r.t);
    }
    for (const a of top) if (a.sessionId && !sessionLabels.has(a.sessionId)) sessionLabels.set(a.sessionId, { label: `${a.projectLabel ?? ''} · ${shortIdOf(a.sessionId)}`, projectId: a.projectId });
    for (const [sid, v] of sessionLabels) {
      if (nodes.length >= MAX_GRAPH_NODES) { truncated = true; break; }
      nodes.push({ id: sid, kind: 'session', label: v.label, role: null, projectId: v.projectId, processed: mainProcessed.get(sid) ?? 0, status: null, orphan: false });
      nodeIds.add(sid);
    }
    for (const a of top) {
      if (nodes.length >= MAX_GRAPH_NODES) { truncated = true; break; }
      const orphan = a.confidence === 'unlinked' || a.confidence === 'unknown';
      nodes.push({ id: a.id, kind: 'agent', label: a.role ?? a.shortId, role: a.role, projectId: a.projectId, processed: a.tokens.processed, status: a.status, orphan });
      nodeIds.add(a.id);
    }
    for (const a of top) {
      if (!nodeIds.has(a.id) || a.confidence === 'unlinked' || a.confidence === 'unknown') continue;
      const from = a.parentAgentId && agentIds.has(a.parentAgentId) ? a.parentAgentId : a.sessionId;
      if (from && nodeIds.has(from)) edges.push({ from, to: a.id, confidence: a.confidence });
    }
    const roles = this.store.all<{ role: string }>('SELECT DISTINCT role FROM agents WHERE role IS NOT NULL ORDER BY role').map((r) => r.role);
    const w2 = this.src(f);
    const usdRow = this.store.get<{ u: number }>(`SELECT COALESCE(SUM(x.usd), 0) AS u FROM (${w2.sql}) x WHERE x.agent_id IS NOT NULL`, ...w2.params);
    return {
      items: page.items,
      total: page.total,
      nextCursor: page.nextCursor,
      period: periodOf(f),
      graph: { nodes, edges, truncated },
      totals: { byConfidence, byStatus, tokens: tokensOf(tot), usdDecimal: formatMicroUsd(BigInt(usdRow?.u ?? 0)) },
      roles,
    };
  }

  agentDetail(id: string, tz: string): AgentDetailDTO {
    const f: Filters = { ...ALL_TIME, tz, projectId: null, modelId: null };
    const agent = this.agentSummaries(f, { agentId: id })[0];
    if (!agent) throw new HttpError(404, 'NOT_FOUND', 'Agent not found.');
    const parentSession = agent.sessionId ? this.sessionRows(f, agent.sessionId)[0] ?? null : null;
    const parentAgent = agent.parentAgentId ? this.agentSummaries(f, { agentId: agent.parentAgentId })[0] ?? null : null;
    const { points, truncated } = this.requestPoints('r.agent_id = ?', [id]);
    return {
      agent,
      parentSession,
      parentAgent,
      children: this.agentSummaries(f, { parentId: id }),
      requests: points,
      truncated,
      evidence: { confidence: agent.confidence, reason: agent.linkReason, toolUseIdMatched: agent.confidence === 'exact' },
    };
  }

  /* ---------- timeline ---------- */

  timeline(f: Filters, groupBy: 'project' | 'agent', laneLimit: number): TimelineDTO {
    const w = buildWhere(f);
    const laneExpr = groupBy === 'project' ? 'r.project_id' : 'r.agent_id';
    const cond = groupBy === 'agent' ? 'AND r.agent_id IS NOT NULL' : 'AND r.project_id IS NOT NULL';
    const it = this.store.iterate<{ lane: string; s: string; ts_ms: number; p: number }>(
      `SELECT ${laneExpr} AS lane, r.session_id AS s, r.ts_ms AS ts_ms, ${PROCESSED_SQL} AS p
       FROM requests r WHERE ${w.sql} ${cond} ORDER BY lane, s, r.ts_ms`,
      ...w.params,
    );
    const lanes = new Map<string, TimelineInterval[]>();
    let total = 0;
    let truncated = false;
    let cur: { lane: string; s: string; start: number; end: number; n: number; p: number } | null = null;
    const flush = (): boolean => {
      if (!cur) return true;
      if (total >= MAX_INTERVALS) { truncated = true; return false; }
      let arr = lanes.get(cur.lane);
      if (!arr) {
        if (lanes.size >= laneLimit) { truncated = true; cur = null; return true; }
        arr = [];
        lanes.set(cur.lane, arr);
      }
      arr.push({
        start: new Date(cur.start).toISOString(),
        end: new Date(cur.end).toISOString(),
        sessionId: cur.s,
        agentId: groupBy === 'agent' ? cur.lane : null,
        requests: cur.n,
        processed: cur.p,
      });
      total += 1;
      cur = null;
      return true;
    };
    for (const r of it) {
      if (cur && cur.lane === r.lane && cur.s === r.s && r.ts_ms - cur.end < GAP_MS) {
        cur.end = r.ts_ms; cur.n += 1; cur.p += r.p;
        continue;
      }
      if (!flush()) break;
      cur = { lane: r.lane, s: r.s, start: r.ts_ms, end: r.ts_ms, n: 1, p: r.p };
    }
    if (!truncated) flush();
    const ids = [...lanes.keys()];
    const labels = new Map<string, string>();
    if (groupBy === 'project') {
      const meta = this.projectMeta(ids);
      for (const id of ids) labels.set(id, this.displayLabel(meta.get(id)) ?? id);
    } else {
      for (let i = 0; i < ids.length; i += 400) {
        const chunk = ids.slice(i, i + 400);
        for (const r of this.store.all<{ id: string; role: string | null }>(`SELECT id, role FROM agents WHERE id IN (${chunk.map(() => '?').join(',')})`, ...chunk)) {
          labels.set(r.id, r.role ?? shortIdOf(r.id));
        }
      }
    }
    return {
      period: periodOf(f),
      groupBy,
      lanes: ids
        .map((id) => ({ id, label: labels.get(id) ?? id, kind: groupBy, intervals: (lanes.get(id) ?? []).sort((a, b) => (a.start < b.start ? -1 : 1)) }))
        .sort((a, b) => (a.label.toLowerCase() < b.label.toLowerCase() ? -1 : 1)),
      truncated,
    };
  }

  /* ---------- costs ---------- */

  costs(f: Filters): CostsDTO {
    const a = this.agg(f);
    const schedule = this.rt.schedule();
    const w = this.src(f);
    const byModel = this.models(f).map((m) => {
      const res = resolveRate(schedule, m.modelId === MISSING_MODEL ? null : m.modelId, null);
      return { ...m, rate: res.ok ? res.entry.rates : null, rateSource: res.ok ? res.entry.source : null };
    });
    const unpriced = this.store
      .all<{ model: string | null; n: number; t: number }>(
        `SELECT x.model AS model, SUM(x.unpriced) AS n, SUM(x.unpriced_tok) AS t FROM (${w.sql}) x WHERE x.unpriced > 0 GROUP BY x.model ORDER BY t DESC, x.model`,
        ...w.params,
      )
      .map((r) => ({ modelId: r.model ?? MISSING_MODEL, requests: r.n, tokens: r.t }));

    // Per-category USD: priced requests only, base or long-prompt card chosen per request. Models without a long-prompt
    // tier come straight from the rollup's priced-token sums; tiered models need per-request rows.
    const pricedByModel = this.store.all<{ model: string | null; pui: number; po: number; pcr: number; pc5: number; pc1: number; pus: number }>(
      `SELECT x.model AS model, SUM(x.pui) AS pui, SUM(x.po) AS po, SUM(x.pcr) AS pcr, SUM(x.pc5) AS pc5, SUM(x.pc1) AS pc1, SUM(x.pus) AS pus
       FROM (${w.sql}) x GROUP BY x.model HAVING SUM(x.n - x.unpriced) > 0`,
      ...w.params,
    );
    const num: Record<keyof TokenUsage, bigint> = { uncachedInput: 0n, output: 0n, cacheRead: 0n, cacheWrite5m: 0n, cacheWrite1h: 0n, unsplitCacheWrite: 0n };
    const tiered: { m: string; threshold: number }[] = [];
    const entries = new Map<string, ReturnType<typeof resolveRate>>();
    for (const g of pricedByModel) {
      const res = resolveRate(schedule, g.model, null);
      if (!res.ok) continue;
      if (res.entry.longPromptTier && g.model !== null) {
        tiered.push({ m: g.model, threshold: res.entry.longPromptTier.thresholdTokens });
        entries.set(g.model, res);
        continue;
      }
      const card = res.entry.rates;
      num.uncachedInput += BigInt(g.pui) * parseRate(card.input);
      num.output += BigInt(g.po) * parseRate(card.output);
      num.cacheRead += BigInt(g.pcr) * parseRate(card.cacheRead);
      num.cacheWrite5m += BigInt(g.pc5) * parseRate(card.cacheWrite5m);
      num.cacheWrite1h += BigInt(g.pc1) * parseRate(card.cacheWrite1h);
      num.unsplitCacheWrite += BigInt(g.pus) * parseRate(card.cacheWrite5m);
    }
    if (tiered.length > 0) {
      const dw = buildWhere(f);
      const caseSql = tiered.map(() => 'WHEN ? THEN ?').join(' ');
      const caseParams = tiered.flatMap((t) => [t.m, t.threshold]);
      const groups = this.store.all<Agg & { model: string | null; tier: number }>(
        `SELECT r.model AS model,
           ((r.uncached_input + r.cache_read + r.cache_write_5m + r.cache_write_1h + r.unsplit_cache_write) > CASE r.model ${caseSql} ELSE 9007199254740991 END) AS tier,
           ${AGG_SQL}
         FROM requests r WHERE ${dw.sql} AND r.micro_usd IS NOT NULL AND r.model IN (${tiered.map(() => '?').join(',')}) GROUP BY r.model, tier`,
        ...caseParams, ...dw.params, ...tiered.map((t) => t.m),
      );
      for (const g of groups) {
        const res = g.model === null ? undefined : entries.get(g.model);
        if (!res || !res.ok) continue;
        const card = g.tier && res.entry.longPromptTier ? res.entry.longPromptTier.rates : res.entry.rates;
        num.uncachedInput += BigInt(g.ui) * parseRate(card.input);
        num.output += BigInt(g.o) * parseRate(card.output);
        num.cacheRead += BigInt(g.cr) * parseRate(card.cacheRead);
        num.cacheWrite5m += BigInt(g.c5) * parseRate(card.cacheWrite5m);
        num.cacheWrite1h += BigInt(g.c1) * parseRate(card.cacheWrite1h);
        num.unsplitCacheWrite += BigInt(g.us) * parseRate(card.cacheWrite5m);
      }
    }
    const tok: TokenTotals = tokensOf(a);
    const cat = (k: keyof TokenUsage) => ({ tokens: tok[k], usdDecimal: formatMicroUsd(roundHalfUp(num[k], RATE_SCALE)) });
    return {
      period: periodOf(f),
      cost: this.cost(f, a),
      byModel,
      byCategory: {
        uncachedInput: cat('uncachedInput'),
        output: cat('output'),
        cacheRead: cat('cacheRead'),
        cacheWrite5m: cat('cacheWrite5m'),
        cacheWrite1h: cat('cacheWrite1h'),
        unsplitCacheWrite: cat('unsplitCacheWrite'),
      },
      daily: this.daily(f),
      unpriced,
      schedule: this.scheduleInfo(),
    };
  }

  scheduleInfo(): CostsDTO['schedule'] {
    const s = this.rt.schedule();
    return {
      version: s.version,
      sourceUrl: s.sourceUrl,
      lastVerified: s.lastVerified,
      notModeled: s.notModeled,
      overrideCount: this.rt.settings.get().rateOverrides.length,
    };
  }

  /* ---------- insights / overview / story ---------- */

  private insights(f: Filters, a: Agg, models: ModelSlice[], projects: ProjectSummary[], daily: DailyPoint[]): Insight[] {
    const out: Insight[] = [];
    if (a.n === 0) return out;
    const processed = processedOf(a);
    const top = projects[0];
    if (top && processed > 0) {
      out.push({
        id: 'most_active_project',
        kind: 'most_active_project',
        params: { project: top.alias ?? top.label, sharePct: Math.round((top.tokens.processed / processed) * 100), tokens: top.tokens.processed },
        evidenceHref: `/projects/${top.id}`,
      });
    }
    if (processed > 0) {
      out.push({ id: 'cache_read_share', kind: 'cache_read_share', params: { sharePct: Math.round((a.cr / processed) * 100) }, evidenceHref: '/costs' });
    }
    const w = this.src(f);
    const ag = this.store.get<{ c: number }>(`SELECT COALESCE(SUM(x.n), 0) AS c FROM (${w.sql}) x WHERE x.agent_id IS NOT NULL`, ...w.params)?.c ?? 0;
    if (ag > 0) {
      out.push({ id: 'delegation_share', kind: 'delegation_share', params: { sharePct: Math.round((ag / a.n) * 100), agentRequests: ag }, evidenceHref: '/agents' });
    }
    let busiest: DailyPoint | undefined;
    for (const d of daily) if (!busiest || d.uniqueRequests > busiest.uniqueRequests) busiest = d;
    if (busiest && busiest.uniqueRequests > 0) {
      out.push({ id: 'busiest_day', kind: 'busiest_day', params: { date: busiest.date, requests: busiest.uniqueRequests }, evidenceHref: '/timeline' });
    }
    if (a.unpriced > 0) {
      out.push({ id: 'unpriced_warning', kind: 'unpriced_warning', params: { requests: a.unpriced, models: this.unpricedModels(f).slice(0, 3).join(', ') }, evidenceHref: '/costs' });
    }
    const lead = models[0];
    if (lead && processed > 0) {
      out.push({ id: 'model_leader', kind: 'model_leader', params: { model: lead.modelId, sharePct: Math.round((lead.tokens.processed / processed) * 100) }, evidenceHref: '/costs' });
    }
    return out;
  }

  overview(f: Filters): OverviewDTO {
    const a = this.agg(f);
    const w = this.src(f);
    const counts = this.store.get<{ s: number; p: number; ag: number }>(
      `SELECT COUNT(DISTINCT x.session_id) AS s, COUNT(DISTINCT x.project_id) AS p, COUNT(DISTINCT x.agent_id) AS ag FROM (${w.sql}) x`,
      ...w.params,
    ) ?? { s: 0, p: 0, ag: 0 };
    const span = f.toMs - f.fromMs;
    const pf: Filters = { ...f, fromMs: f.fromMs - span, toMs: f.fromMs };
    const pa = this.agg(pf);
    const pw = pa.n > 0 ? this.src(pf) : null;
    const pcounts = pw ? (this.store.get<{ s: number }>(`SELECT COUNT(DISTINCT x.session_id) AS s FROM (${pw.sql}) x`, ...pw.params)?.s ?? 0) : 0;
    const daily = this.daily(f);
    const models = this.models(f);
    const topProjects = this.toProjectSummaries(f, this.projectAggRows(f, 'tokens').slice(0, 5));

    const laneRows = this.store.all<{ role: string | null; b: number; n: number }>(
      `SELECT a.role AS role, x.bucket AS b, SUM(x.n) AS n FROM (${w.sql}) x JOIN agents a ON a.id = x.agent_id GROUP BY a.role, b`,
      ...w.params,
    );
    const inv = new Map(
      this.store
        .all<{ role: string | null; c: number }>(`SELECT a.role AS role, COUNT(DISTINCT x.agent_id) AS c FROM (${w.sql}) x JOIN agents a ON a.id = x.agent_id GROUP BY a.role`, ...w.params)
        .map((r) => [r.role, r.c]),
    );
    const lanes = new Map<string | null, number[]>();
    for (const r of laneRows) {
      let h = lanes.get(r.role);
      if (!h) { h = new Array<number>(24).fill(0); lanes.set(r.role, h); }
      const hr = localHour(r.b * BUCKET_MS, f.tz);
      h[hr] = (h[hr] ?? 0) + r.n;
    }
    const agentLanes = [...lanes.entries()]
      .map(([role, hourly]) => ({ role, invocations: inv.get(role) ?? 0, hourly }))
      .sort((x, y) => y.invocations - x.invocations || ((x.role ?? '') < (y.role ?? '') ? -1 : 1))
      .slice(0, 8);

    return {
      mode: this.rt.mode(),
      period: periodOf(f),
      asOf: new Date(this.now()).toISOString(),
      revision: this.rt.revision,
      kpis: {
        uniqueRequests: { value: a.n, quality: 'observed', reason: 'reason.observedUsage' },
        tokens: { ...tokensOf(a), quality: 'observed' },
        cost: this.cost(f, a),
        sessions: { value: counts.s, quality: 'derived', reason: 'reason.derivedCount' },
        projects: { value: counts.p, quality: 'derived', reason: 'reason.derivedCount' },
        subagents: { value: counts.ag, quality: 'derived', reason: 'reason.derivedCount' },
      },
      previous:
        pa.n === 0
          ? null
          : {
              uniqueRequests: pa.n,
              processedTokens: processedOf(pa),
              usdDecimal: usdOf(pa),
              sessions: pcounts,
              requestCoverage: (pa.n - pa.unpriced) / pa.n,
            },
      daily,
      models,
      topProjects,
      agentLanes,
      insights: this.insights(f, a, models, topProjects, daily),
      coverage: this.coverage(f, a),
    };
  }

  story(f: Filters): StoryDTO {
    const o = this.overview(f);
    const w = this.src(f);
    const split = this.store.get<{ m: number; a: number }>(
      `SELECT COALESCE(SUM(CASE WHEN x.agent_id IS NULL THEN x.n ELSE 0 END), 0) AS m, COALESCE(SUM(CASE WHEN x.agent_id IS NOT NULL THEN x.n ELSE 0 END), 0) AS a FROM (${w.sql}) x`,
      ...w.params,
    ) ?? { m: 0, a: 0 };
    const roles = this.store.all<{ role: string | null; n: number }>(
      `SELECT a.role AS role, SUM(x.n) AS n FROM (${w.sql}) x JOIN agents a ON a.id = x.agent_id GROUP BY a.role ORDER BY n DESC, a.role LIMIT 5`,
      ...w.params,
    );
    const byConfidence: Record<LinkConfidence, number> = { exact: 0, inferred: 0, unlinked: 0, unknown: 0 };
    for (const r of this.store.all<{ confidence: LinkConfidence; c: number }>(
      `SELECT a.confidence AS confidence, COUNT(DISTINCT a.id) AS c FROM agents a JOIN (${w.sql}) x ON x.agent_id = a.id GROUP BY a.confidence`,
      ...w.params,
    )) byConfidence[r.confidence] = r.c;
    const t = o.kpis.tokens;
    const p = t.processed;
    return {
      period: o.period,
      mode: o.mode,
      overview: { kpis: o.kpis, daily: o.daily, models: o.models, topProjects: o.topProjects, coverage: o.coverage, insights: o.insights },
      delegation: {
        mainRequests: split.m,
        agentRequests: split.a,
        agentShare: split.m + split.a === 0 ? 0 : split.a / (split.m + split.a),
        topRoles: roles.map((r) => ({ role: r.role, requests: r.n })),
        byConfidence,
      },
      cache: {
        cacheReadShare: p === 0 ? 0 : t.cacheRead / p,
        cacheWriteShare: p === 0 ? 0 : (t.cacheWrite5m + t.cacheWrite1h + t.unsplitCacheWrite) / p,
        uncachedInputShare: p === 0 ? 0 : t.uncachedInput / p,
      },
      schedule: this.scheduleInfo(),
    };
  }

  /* ---------- diagnostics ---------- */

  diagnostics(): DiagnosticsDTO {
    const last = this.rt.lastScan();
    const warnings: Record<string, number> = {};
    for (const r of this.store.all<{ code: string; c: number }>('SELECT code, SUM(count) AS c FROM parse_warnings GROUP BY code ORDER BY code')) warnings[r.code] = r.c;
    const orphan = this.store.get<{ c: number }>("SELECT COUNT(*) AS c FROM agents WHERE confidence IN ('unlinked','unknown')")?.c ?? 0;
    const unpriced = this.store.get<{ c: number }>('SELECT COUNT(*) AS c FROM requests WHERE micro_usd IS NULL')?.c ?? 0;
    const models = this.store
      .all<{ m: string | null }>('SELECT DISTINCT model AS m FROM requests WHERE micro_usd IS NULL ORDER BY m')
      .map((r) => r.m ?? MISSING_MODEL);
    const st = this.rt.status();
    return {
      lastScan: {
        startedAt: last?.startedAt ?? null,
        finishedAt: last?.finishedAt ?? null,
        durationMs: last?.durationMs ?? null,
        filesScanned: last?.filesScanned ?? 0,
        filesSkipped: last?.filesSkipped ?? 0,
        bytesRead: last?.bytesRead ?? 0,
      },
      warningsByCode: warnings,
      discovery: last?.discovery ?? { symlinksSkipped: 0, oversizeSkipped: 0, ignoredFiles: 0, unreadable: 0 },
      orphanAgents: orphan,
      unpricedRequests: unpriced,
      unpricedModels: models,
      watcher: st.watcher,
      dbSizeBytes: this.store.sizeBytes(),
      schemaVersion: this.store.schemaVersion,
    };
  }
}
