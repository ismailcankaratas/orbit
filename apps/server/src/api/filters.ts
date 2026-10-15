import { z } from 'zod';
import type { Period } from '@orbit/core';
import { HttpError } from '../errors.js';
import { isValidTimezone } from '../config/settings.js';

export const DAY_MS = 86_400_000;
export const MAX_PERIOD_DAYS = 36_600;
export const MISSING_MODEL = '(missing model)';

export interface Filters {
  fromMs: number;
  toMs: number;
  tz: string;
  projectId: string | null;
  modelId: string | null;
}

const iso = z
  .string()
  .max(40)
  .refine((s) => !Number.isNaN(Date.parse(s)), 'invalid date');

export const filterSchema = z.object({
  from: iso.optional(),
  to: iso.optional(),
  tz: z.string().max(64).optional(),
  projectId: z.string().regex(/^p_[0-9a-f]{12}$/).optional(),
  modelId: z.string().min(1).max(128).optional(),
});

export const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().max(256).optional(),
});

export function parseQuery<T extends z.ZodTypeAny>(schema: T, query: unknown): z.infer<T> {
  const r = schema.safeParse(query);
  if (!r.success) {
    const fields = [...new Set(r.error.issues.map((i) => String(i.path[0] ?? 'query')))].slice(0, 5).join(', ');
    throw new HttpError(400, 'INVALID_FILTER', `Invalid query parameter: ${fields}`);
  }
  return r.data;
}

export function resolveFilters(q: z.infer<typeof filterSchema>, defaultTz: string, nowMs: number): Filters {
  const tz = q.tz ?? defaultTz;
  if (!isValidTimezone(tz)) throw new HttpError(400, 'INVALID_FILTER', 'Invalid query parameter: tz');
  const toMs = q.to ? Date.parse(q.to) : nowMs;
  const fromMs = q.from ? Date.parse(q.from) : toMs - 30 * DAY_MS;
  if (!(fromMs < toMs) || toMs - fromMs > MAX_PERIOD_DAYS * DAY_MS) {
    throw new HttpError(400, 'INVALID_FILTER', 'Invalid query parameter: from/to');
  }
  return { fromMs, toMs, tz, projectId: q.projectId ?? null, modelId: q.modelId ?? null };
}

export function periodOf(f: Filters): Period {
  return { from: new Date(f.fromMs).toISOString(), to: new Date(f.toMs).toISOString(), tz: f.tz };
}

export function buildWhere(f: Filters, a = 'r'): { sql: string; params: (string | number)[] } {
  const parts = [`${a}.ts_ms >= ?`, `${a}.ts_ms < ?`];
  const params: (string | number)[] = [f.fromMs, f.toMs];
  if (f.projectId) {
    parts.push(`${a}.project_id = ?`);
    params.push(f.projectId);
  }
  if (f.modelId) {
    if (f.modelId === MISSING_MODEL) parts.push(`${a}.model IS NULL`);
    else {
      parts.push(`${a}.model = ?`);
      params.push(f.modelId);
    }
  }
  return { sql: parts.join(' AND '), params };
}

/* ---------- opaque cursor ---------- */

export function encodeCursor(offset: number, sort: string): string {
  return Buffer.from(JSON.stringify({ o: offset, s: sort }), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string | undefined, sort: string): number {
  if (!cursor) return 0;
  try {
    const v = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { o?: unknown; s?: unknown };
    if (typeof v.o === 'number' && Number.isInteger(v.o) && v.o >= 0 && v.o < 1_000_000 && v.s === sort) return v.o;
  } catch {
    /* fallthrough */
  }
  throw new HttpError(400, 'INVALID_FILTER', 'Invalid query parameter: cursor');
}

export function paginate<T>(all: T[], limit: number, cursor: string | undefined, sort: string): { items: T[]; total: number; nextCursor: string | null } {
  const offset = decodeCursor(cursor, sort);
  const items = all.slice(offset, offset + limit);
  const next = offset + limit;
  return { items, total: all.length, nextCursor: next < all.length ? encodeCursor(next, sort) : null };
}

/* ---------- timezone helpers ---------- */

const dateFmt = new Map<string, Intl.DateTimeFormat>();
const hourFmt = new Map<string, Intl.DateTimeFormat>();

export function localDate(ms: number, tz: string): string {
  let f = dateFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
    dateFmt.set(tz, f);
  }
  return f.format(new Date(ms));
}

export function localHour(ms: number, tz: string): number {
  let f = hourFmt.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' });
    hourFmt.set(tz, f);
  }
  return Number(f.format(new Date(ms))) % 24;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 4000; d = addDays(d, 1)) out.push(d);
  return out;
}
