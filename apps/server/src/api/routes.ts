import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { MONEY_DISCLAIMER_EN, type SettingsDTO } from '@orbit/core';
import { buildExport, toCsv } from '../export/index.js';
import { HttpError } from '../errors.js';
import type { Runtime } from '../runtime.js';
import { sanitizeAlias } from '../scanner/identity.js';
import { filterSchema, pageSchema, parseQuery, resolveFilters, type Filters } from './filters.js';
import { Queries } from './queries.js';

void MONEY_DISCLAIMER_EN;

/** Concurrent SSE clients allowed (each holds a socket and a heartbeat timer). */
export const MAX_SSE_CLIENTS = 16;

const idParam = z.object({ id: z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/) });
const roleSlug = z.string().regex(/^[a-z0-9._-]{1,64}$/);
const safeId = z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/);

const baseQuery = filterSchema;
const projectsQuery = filterSchema.merge(pageSchema).extend({ sort: z.enum(['tokens', 'cost', 'requests', 'recent', 'label']).optional() });
const pagedQuery = filterSchema.merge(pageSchema);
const agentsQuery = filterSchema.merge(pageSchema).extend({
  role: roleSlug.optional(),
  confidence: z.enum(['exact', 'inferred', 'unlinked', 'unknown']).optional(),
  sessionId: safeId.optional(),
});
const timelineQuery = filterSchema.extend({
  groupBy: z.enum(['project', 'agent']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
const exportQuery = filterSchema.extend({ format: z.enum(['csv', 'json']) });
const tzOnly = z.object({ tz: z.string().max(64).optional() });
const aliasBody = z.object({ alias: z.string().max(200).nullable() }).strict();
const archiveBody = z.object({ confirm: z.literal('DELETE_ORBIT_DATA') }).strict();

export function registerRoutes(app: FastifyInstance, rt: Runtime, csrfToken: string): void {
  const q = new Queries(rt);
  const filters = (query: unknown, schema: z.ZodTypeAny = baseQuery): Filters =>
    resolveFilters(parseQuery(schema, query) as z.infer<typeof filterSchema>, rt.settings.get().timezone, rt.clock());
  const tzOf = (query: unknown): string => {
    const t = parseQuery(tzOnly, query).tz;
    return resolveFilters({ ...(t ? { tz: t } : {}) }, rt.settings.get().timezone, rt.clock()).tz;
  };

  app.get('/health', async () => ({ status: 'ok', version: rt.config.version }));
  app.get('/api/v1/session', async () => ({ csrfToken, version: rt.config.version }));
  app.get('/api/v1/status', async () => rt.status());
  app.get('/api/v1/overview', async (req) => q.overview(filters(req.query)));
  app.get('/api/v1/reports/summary', async (req) => q.story(filters(req.query)));
  app.get('/api/v1/costs', async (req) => q.costs(filters(req.query)));
  app.get('/api/v1/diagnostics', async () => q.diagnostics());

  app.get('/api/v1/projects', async (req) => {
    const p = parseQuery(projectsQuery, req.query);
    const f = resolveFilters(p, rt.settings.get().timezone, rt.clock());
    return q.projects(f, p.sort ?? 'tokens', p.limit ?? 50, p.cursor);
  });
  app.get('/api/v1/projects/:id', async (req) => {
    const { id } = parseQuery(idParam, req.params);
    return q.projectDetail(id, filters(req.query));
  });
  app.put('/api/v1/projects/:id/alias', async (req) => {
    const { id } = parseQuery(idParam, req.params);
    const body = aliasBody.safeParse(req.body);
    if (!body.success) throw new HttpError(400, 'INVALID_FILTER', 'Invalid request: alias');
    if (body.data.alias !== null && body.data.alias.trim().length > 60) throw new HttpError(400, 'INVALID_FILTER', 'Invalid request: alias');
    const alias = body.data.alias === null ? null : sanitizeAlias(body.data.alias);
    const store = rt.store();
    if (!store.get('SELECT 1 AS x FROM projects WHERE id = ?', id)) throw new HttpError(404, 'NOT_FOUND', 'Project not found.');
    store.run('UPDATE projects SET alias = ? WHERE id = ?', alias === '' ? null : alias, id);
    rt.notifyChanged([id]);
    const summary = q.projectSummary(id, filters({}));
    if (!summary) throw new HttpError(404, 'NOT_FOUND', 'Project not found.');
    return summary;
  });

  app.get('/api/v1/sessions', async (req) => {
    const p = parseQuery(pagedQuery, req.query);
    return q.sessions(resolveFilters(p, rt.settings.get().timezone, rt.clock()), p.limit ?? 50, p.cursor);
  });
  app.get('/api/v1/sessions/:id', async (req) => {
    const { id } = parseQuery(idParam, req.params);
    return q.sessionDetail(id, tzOf(req.query));
  });

  app.get('/api/v1/agents', async (req) => {
    const p = parseQuery(agentsQuery, req.query);
    const f = resolveFilters(p, rt.settings.get().timezone, rt.clock());
    const extra: { role?: string; confidence?: string; sessionId?: string } = {};
    if (p.role) extra.role = p.role;
    if (p.confidence) extra.confidence = p.confidence;
    if (p.sessionId) extra.sessionId = p.sessionId;
    return q.agents(f, extra, p.limit ?? 50, p.cursor);
  });
  app.get('/api/v1/agents/:id', async (req) => {
    const { id } = parseQuery(idParam, req.params);
    return q.agentDetail(id, tzOf(req.query));
  });

  app.get('/api/v1/timeline', async (req) => {
    const p = parseQuery(timelineQuery, req.query);
    const f = resolveFilters(p, rt.settings.get().timezone, rt.clock());
    return q.timeline(f, p.groupBy ?? 'project', p.limit ?? 50);
  });

  app.get('/api/v1/exports', async (req, reply: FastifyReply) => {
    const p = parseQuery(exportQuery, req.query);
    const f = resolveFilters(p, rt.settings.get().timezone, rt.clock());
    const { rows, meta } = buildExport(rt, f);
    const stamp = new Date(rt.clock()).toISOString().slice(0, 10).replace(/-/g, '');
    reply.header('Content-Disposition', `attachment; filename="orbit-export-${stamp}.${p.format}"`);
    reply.header('X-Orbit-Estimate-Type', meta.estimate_type);
    reply.header('X-Orbit-Rate-Schedule-Version', meta.rate_schedule_version);
    if (p.format === 'json') {
      reply.type('application/json; charset=utf-8');
      return JSON.stringify({ meta, rows });
    }
    reply.type('text/csv; charset=utf-8');
    return toCsv(rows);
  });

  app.get('/api/v1/settings', async (): Promise<SettingsDTO> => rt.settingsDTO());
  app.patch('/api/v1/settings', async (req) => rt.patchSettings(req.body));

  app.post('/api/v1/scan', async (_req, reply) => {
    const state = rt.manualScan();
    reply.code(202);
    return state;
  });

  app.delete('/api/v1/archive', async (req) => {
    const body = archiveBody.safeParse(req.body);
    if (!body.success) throw new HttpError(400, 'INVALID_FILTER', 'Confirmation text missing or incorrect.');
    await rt.purgeArchive();
    return { deleted: true };
  });

  /* ---------- SSE ---------- */
  const closers = new Set<() => void>();
  const heartbeatMs = rt.config.sseHeartbeatMs ?? 25_000;
  app.addHook('onClose', async () => {
    for (const c of [...closers]) c();
  });
  app.get('/api/v1/events', (req: FastifyRequest, reply: FastifyReply) => {
    if (closers.size >= MAX_SSE_CLIENTS) {
      throw new HttpError(503, 'RATE_LIMITED', 'Too many live connections; close another Orbit tab and retry.', true);
    }
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      ...reply.getHeaders(),
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    } as Record<string, string>);
    raw.write('retry: 3000\n: connected\n\n');
    const unsub = rt.subscribe((e) => {
      raw.write(`event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
    });
    const hb = setInterval(() => raw.write(': heartbeat\n\n'), heartbeatMs);
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(hb);
      unsub();
      closers.delete(close);
      if (!raw.writableEnded) raw.end();
    };
    closers.add(close);
    req.raw.on('close', close);
    raw.on('error', close);
  });
}
