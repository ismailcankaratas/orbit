import {
  EXPORT_COLUMNS,
  MONEY_DISCLAIMER_EN,
  formatMicroUsd,
  type ExportMeta,
} from '@orbit/core';
import { AGG_X, type Agg } from '../api/agg.js';
import { MISSING_MODEL, buildWhere, localDate, periodOf, type Filters } from '../api/filters.js';
import { sourceSql } from '../db/rollup.js';
import { HttpError } from '../errors.js';
import type { Runtime } from '../runtime.js';

export const MAX_EXPORT_ROWS = 100_000;
const fmtLimit = (n: number): string => n.toLocaleString('en-US');
const BUCKET_MS = 900_000;

export type ExportRow = Record<(typeof EXPORT_COLUMNS)[number], string | number | null>;

/** CSV formula injection defense: neutralize cells that a spreadsheet would evaluate. */
export function neutralizeCell(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

function csvCell(v: string | number | null): string {
  if (v === null) return '';
  const s = typeof v === 'number' ? String(v) : neutralizeCell(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: ExportRow[]): string {
  const lines = [EXPORT_COLUMNS.join(',')];
  for (const r of rows) lines.push(EXPORT_COLUMNS.map((c) => csvCell(r[c])).join(','));
  return lines.join('\r\n') + '\r\n';
}

export interface ExportResult {
  rows: ExportRow[];
  meta: ExportMeta;
}

export function buildExport(rt: Runtime, f: Filters): ExportResult {
  const store = rt.store();
  const limit = rt.config.exportMaxRows ?? MAX_EXPORT_ROWS;
  const w = buildWhere(f);
  const src = sourceSql(store, f, rt.rollupEnabled, MISSING_MODEL);
  const groups = store.all<Agg & { b: number; pid: string | null; model: string | null }>(
    `SELECT x.bucket AS b, x.project_id AS pid, x.model AS model, ${AGG_X}
     FROM (${src.sql}) x GROUP BY b, pid, model`,
    ...src.params,
  );
  const folded = new Map<string, Agg & { pid: string | null; model: string | null; date: string }>();
  for (const g of groups) {
    const date = localDate(g.b * BUCKET_MS, f.tz);
    const key = `${date}\0${g.pid ?? ''}\0${g.model ?? ''}`;
    let cur = folded.get(key);
    if (!cur) {
      cur = { n: 0, ui: 0, o: 0, cr: 0, c5: 0, c1: 0, us: 0, usd: 0, unpriced: 0, fb: 0, unpriced_tok: 0, pid: g.pid, model: g.model, date };
      folded.set(key, cur);
      if (folded.size > limit) throw new HttpError(413, 'EXPORT_TOO_LARGE', `Export exceeds the ${fmtLimit(limit)} row limit; narrow the date range.`);
    }
    cur.n += g.n; cur.ui += g.ui; cur.o += g.o; cur.cr += g.cr; cur.c5 += g.c5; cur.c1 += g.c1; cur.us += g.us;
    cur.usd += g.usd; cur.unpriced += g.unpriced; cur.fb += g.fb; cur.unpriced_tok += g.unpriced_tok;
  }
  const labels = new Map<string, string>();
  for (const p of store.all<{ id: string; label: string; alias: string | null }>('SELECT id, label, alias FROM projects')) {
    labels.set(p.id, p.alias && p.alias.length > 0 ? p.alias : p.label);
  }
  const rows: ExportRow[] = [...folded.values()]
    .map((g) => {
      const priced = g.n - g.unpriced;
      const quality = priced === 0 ? 'unpriced' : g.unpriced > 0 ? 'partial' : g.fb > 0 ? 'estimated_fallback' : 'priced';
      return {
        date: g.date,
        project_id: g.pid ?? '',
        project_label: g.pid ? labels.get(g.pid) ?? '' : '',
        model: g.model ?? MISSING_MODEL,
        requests: g.n,
        uncached_input_tokens: g.ui,
        output_tokens: g.o,
        cache_read_tokens: g.cr,
        cache_write_5m_tokens: g.c5,
        cache_write_1h_tokens: g.c1,
        unsplit_cache_write_tokens: g.us,
        estimated_api_equivalent_usd: priced === 0 ? null : formatMicroUsd(BigInt(g.usd)),
        price_quality: quality,
      } satisfies ExportRow;
    })
    .sort((a, b) =>
      String(a.date) !== String(b.date)
        ? String(a.date) < String(b.date) ? -1 : 1
        : String(a.project_label) + String(a.model) < String(b.project_label) + String(b.model) ? -1 : 1,
    );

  const span = store.get<{ lo: number | null; hi: number | null; unpriced: number }>(
    `SELECT MIN(r.ts_ms) AS lo, MAX(r.ts_ms) AS hi, COALESCE(SUM(CASE WHEN r.micro_usd IS NULL THEN 1 ELSE 0 END), 0) AS unpriced
     FROM requests r WHERE ${w.sql}`,
    ...w.params,
  );
  const excluded = store
    .all<{ m: string | null }>(`SELECT DISTINCT r.model AS m FROM requests r WHERE ${w.sql} AND r.micro_usd IS NULL ORDER BY m`, ...w.params)
    .map((r) => r.m ?? MISSING_MODEL);
  const meta: ExportMeta = {
    source_mode: rt.mode() === 'demo' ? 'synthetic_demo' : 'local_claude_code',
    estimate_type: 'api_price_equivalent',
    disclaimer: MONEY_DISCLAIMER_EN,
    rate_schedule_version: rt.schedule().version,
    unknown_priced_requests: span?.unpriced ?? 0,
    excluded_unknown_models: excluded,
    coverage_window: {
      from: span?.lo != null ? new Date(span.lo).toISOString() : null,
      to: span?.hi != null ? new Date(span.hi).toISOString() : null,
    },
    period: periodOf(f),
    generated_at: new Date(rt.clock()).toISOString(),
    columns: EXPORT_COLUMNS,
  };
  return { rows, meta };
}
