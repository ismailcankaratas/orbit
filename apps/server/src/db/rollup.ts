import type { Store } from './store.js';

/**
 * Maintained 15-minute rollup of `requests` (table `request_buckets`).
 *
 * Design (see also migration 2): SQLite triggers on `requests` record the old and new 15-minute bucket of every
 * inserted / updated / deleted row (including FK cascades, project re-attribution and re-pricing) into
 * `dirty_buckets` inside the SAME transaction as the mutation. A refresh (end of each scan, store open) deletes and
 * regroups only the dirty buckets and clears the marks in one transaction. Readers use the rollup only while
 * `dirty_buckets` is empty; otherwise they fall back to direct queries over `requests`, so results are exact at every
 * instant, including mid-scan and after a crash. The dimension set is bucket x project x session x agent x model;
 * `source_kind` is not stored because no endpoint reads it (main vs agent is `agent_id IS NULL`).
 *
 * Arbitrary [from, to) ranges stay exact: whole buckets come from the rollup, the (at most two) partial edge
 * buckets are read per request row from `requests` and merged with UNION ALL in the same column shape.
 */
export const BUCKET_MS = 900_000;
/** Above this many dirty buckets a full rebuild is cheaper than per-bucket regrouping. */
export const FULL_REBUILD_THRESHOLD = 1500;

const PROC = '(r.uncached_input + r.output + r.cache_read + r.cache_write_5m + r.cache_write_1h + r.unsplit_cache_write)';

/** Column list shared by the rollup table and per-row pseudo rows (n = 1). */
export const ROLLUP_COLUMNS = [
  'bucket', 'project_id', 'session_id', 'agent_id', 'model', 'n',
  'ui', 'o', 'cr', 'c5', 'c1', 'us', 'usd', 'unpriced', 'fb', 'unpriced_tok',
  'pui', 'po', 'pcr', 'pc5', 'pc1', 'pus', 'arch', 'tmin', 'tmax',
] as const;

const priced = (col: string): string => `CASE WHEN r.micro_usd IS NULL THEN 0 ELSE r.${col} END`;

/** One pseudo rollup row per request, from `requests r`. */
const ROW_SELECT = `SELECT r.ts_ms / ${BUCKET_MS} AS bucket, r.project_id AS project_id, r.session_id AS session_id, r.agent_id AS agent_id,
  r.model AS model, 1 AS n, r.uncached_input AS ui, r.output AS o, r.cache_read AS cr, r.cache_write_5m AS c5,
  r.cache_write_1h AS c1, r.unsplit_cache_write AS us, COALESCE(r.micro_usd, 0) AS usd,
  (r.micro_usd IS NULL) AS unpriced, (r.price_quality = 'estimated_fallback') AS fb,
  CASE WHEN r.micro_usd IS NULL THEN ${PROC} ELSE 0 END AS unpriced_tok,
  ${priced('uncached_input')} AS pui, ${priced('output')} AS po, ${priced('cache_read')} AS pcr,
  ${priced('cache_write_5m')} AS pc5, ${priced('cache_write_1h')} AS pc1, ${priced('unsplit_cache_write')} AS pus,
  (r.source_present = 0) AS arch, r.ts_ms AS tmin, r.ts_ms AS tmax
FROM requests r`;

function groupInsertSql(where: string): string {
  return `INSERT INTO request_buckets
SELECT bucket, project_id, session_id, agent_id, model, SUM(n), SUM(ui), SUM(o), SUM(cr), SUM(c5), SUM(c1), SUM(us), SUM(usd),
  SUM(unpriced), SUM(fb), SUM(unpriced_tok), SUM(pui), SUM(po), SUM(pcr), SUM(pc5), SUM(pc1), SUM(pus), SUM(arch), MIN(tmin), MAX(tmax)
FROM (${ROW_SELECT} WHERE r.ts_ms IS NOT NULL AND ${where})
GROUP BY bucket, project_id, session_id, agent_id, model`;
}

export function rollupValid(store: Store): boolean {
  return store.get('SELECT 1 AS x FROM dirty_buckets LIMIT 1') === undefined;
}

/** Bring the rollup up to date. Safe to call when nothing is dirty. Returns the number of buckets regrouped (-1 = full). */
export function refreshRollup(store: Store): number {
  if (rollupValid(store)) return 0;
  return store.tx(() => {
    const dirty = store.all<{ bucket: number }>('SELECT bucket FROM dirty_buckets').map((r) => r.bucket);
    if (dirty.length > FULL_REBUILD_THRESHOLD) {
      store.run('DELETE FROM request_buckets');
      store.exec(groupInsertSql('1 = 1'));
      store.run('DELETE FROM dirty_buckets');
      return -1;
    }
    for (const b of dirty) {
      store.run('DELETE FROM request_buckets WHERE bucket = ?', b);
      store.run(groupInsertSql('r.ts_ms >= ? AND r.ts_ms < ?'), b * BUCKET_MS, (b + 1) * BUCKET_MS);
    }
    store.run('DELETE FROM dirty_buckets');
    return dirty.length;
  });
}

/** Drop and rebuild the whole rollup from `requests` (used by tests and repair). */
export function rebuildRollup(store: Store): void {
  store.tx(() => {
    store.run('DELETE FROM request_buckets');
    store.exec(groupInsertSql('1 = 1'));
    store.run('DELETE FROM dirty_buckets');
  });
}

export interface SourceRange {
  fromMs: number;
  toMs: number;
  projectId?: string | null;
  projectIds?: readonly string[];
  modelId?: string | null;
}

export interface SourceSql {
  /** Body of a derived table with {@link ROLLUP_COLUMNS}; embed as `FROM (sql) x`. */
  sql: string;
  params: (string | number)[];
  usedRollup: boolean;
}

/**
 * Derived-table SQL equivalent to `requests` rows in [from, to) (that match the optional filters), expressed as
 * rollup-shaped rows. `useRollup=false` (or a dirty/unavailable rollup) yields one pseudo row per request.
 */
export function sourceSql(store: Store, r: SourceRange, useRollup: boolean, missingModel: string): SourceSql {
  const filt = (a: string): { sql: string; params: (string | number)[] } => {
    const parts: string[] = [];
    const params: (string | number)[] = [];
    if (r.projectId) {
      parts.push(`${a}.project_id = ?`);
      params.push(r.projectId);
    }
    if (r.projectIds) {
      if (r.projectIds.length === 0) parts.push('0');
      else {
        parts.push(`${a}.project_id IN (${r.projectIds.map(() => '?').join(',')})`);
        params.push(...r.projectIds);
      }
    }
    if (r.modelId) {
      if (r.modelId === missingModel) parts.push(`${a}.model IS NULL`);
      else {
        parts.push(`${a}.model = ?`);
        params.push(r.modelId);
      }
    }
    return { sql: parts.length ? ' AND ' + parts.join(' AND ') : '', params };
  };
  const rowPart = (lo: number, hi: number): { sql: string; params: (string | number)[] } => {
    const f = filt('r');
    return { sql: `${ROW_SELECT} WHERE r.ts_ms >= ? AND r.ts_ms < ?${f.sql}`, params: [lo, hi, ...f.params] };
  };
  const bLo = Math.ceil(r.fromMs / BUCKET_MS);
  const bHi = Math.floor(r.toMs / BUCKET_MS);
  if (!useRollup || bLo >= bHi || !rollupValid(store)) {
    const p = rowPart(r.fromMs, r.toMs);
    return { sql: p.sql, params: p.params, usedRollup: false };
  }
  const f = filt('b');
  const cols = ROLLUP_COLUMNS.map((c) => `b.${c} AS ${c}`).join(', ');
  const members: string[] = [`SELECT ${cols} FROM request_buckets b WHERE b.bucket >= ? AND b.bucket < ?${f.sql}`];
  const params: (string | number)[] = [bLo, bHi, ...f.params];
  if (r.fromMs < bLo * BUCKET_MS) {
    const p = rowPart(r.fromMs, bLo * BUCKET_MS);
    members.push(p.sql);
    params.push(...p.params);
  }
  if (bHi * BUCKET_MS < r.toMs) {
    const p = rowPart(bHi * BUCKET_MS, r.toMs);
    members.push(p.sql);
    params.push(...p.params);
  }
  return { sql: members.join('\nUNION ALL\n'), params, usedRollup: true };
}
