import { existsSync } from 'node:fs';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { registerRoutes } from './api/routes.js';
import { loadConfig, type ServerConfig } from './config/index.js';
import { HttpError } from './errors.js';
import { Runtime } from './runtime.js';
import { CSP, newCsrfToken, registerSecurity } from './security/index.js';

declare module 'fastify' {
  interface FastifyInstance {
    orbit: Runtime;
    csrfToken: string;
  }
}

export interface BuildAppOptions {
  config?: ServerConfig;
  clock?: () => number;
  /** Serve apps/web/dist (default true). */
  serveWeb?: boolean;
  /** Use stat polling instead of fs.watch. */
  forcePolling?: boolean;
}

const NOTICE = 'Orbit web UI is not built yet. Run `npm run build` and restart Orbit.\n';

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const config = opts.config ?? loadConfig();
  const rt = new Runtime(config, { ...(opts.clock ? { clock: opts.clock } : {}), ...(opts.forcePolling ? { forcePolling: true } : {}) });
  const csrfToken = newCsrfToken();
  let port = config.port;

  const app = Fastify({
    logger: false,
    bodyLimit: 256 * 1024,
    forceCloseConnections: true,
    // Node answers malformed / oversized requests itself (e.g. 431); give those the Orbit error shape and headers too.
    clientErrorHandler: (err, socket) => {
      if (!socket.writable || socket.destroyed) return;
      const code = (err as NodeJS.ErrnoException).code ?? '';
      const status = code === 'HPE_HEADER_OVERFLOW' || code === 'ERR_HTTP_REQUEST_HEADER_OVERFLOW' ? 431 : 400;
      const body = JSON.stringify(new HttpError(status, 'INVALID_FILTER', 'Invalid request.').toBody());
      socket.end(
        `HTTP/1.1 ${status} ${status === 431 ? 'Request Header Fields Too Large' : 'Bad Request'}\r\n` +
          'Content-Type: application/json; charset=utf-8\r\n' +
          `Content-Length: ${Buffer.byteLength(body)}\r\n` +
          `Content-Security-Policy: ${CSP}\r\nX-Content-Type-Options: nosniff\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n${body}`,
      );
    },
  });
  app.decorate('orbit', rt);
  app.decorate('csrfToken', csrfToken);

  registerSecurity(app, { port: () => port, dev: config.dev, csrfToken });
  app.addHook('onListen', async () => {
    const a = app.server.address();
    if (a && typeof a === 'object') port = a.port;
  });
  app.addHook('onClose', async () => {
    await rt.stop();
  });

  // Tolerate an empty JSON body (e.g. POST /scan with content-type but no payload).
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text.trim() === '') return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch {
      done(new HttpError(400, 'INVALID_FILTER', 'Request body is not valid JSON.'));
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send(err.toBody());
    if (err instanceof ZodError) return reply.code(400).send(new HttpError(400, 'INVALID_FILTER', 'Invalid request.').toBody());
    const e = err as { statusCode?: number; code?: string };
    if (e.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.code(413).send(new HttpError(413, 'INVALID_FILTER', 'Request body too large.').toBody());
    }
    if (typeof e.statusCode === 'number' && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.code(e.statusCode).send(new HttpError(e.statusCode, 'INVALID_FILTER', 'Invalid request.').toBody());
    }
    return reply.code(500).send(new HttpError(500, 'INTERNAL', 'Internal error.', true).toBody());
  });

  registerRoutes(app, rt, csrfToken);

  const hasWeb = opts.serveWeb !== false && existsSync(join(config.webDist, 'index.html'));
  if (hasWeb) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false, index: ['index.html'], dotfiles: 'deny' });
  }
  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split('?')[0] ?? '/';
    if (path.startsWith('/api/') || path === '/health') {
      return reply.code(404).send(new HttpError(404, 'NOT_FOUND', 'Not found.').toBody());
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return reply.code(404).send(new HttpError(404, 'NOT_FOUND', 'Not found.').toBody());
    }
    if (!hasWeb) return reply.code(200).type('text/plain; charset=utf-8').send(NOTICE);
    if (/\.[a-z0-9]{1,8}$/i.test(path)) return reply.code(404).type('text/plain; charset=utf-8').send('Not found\n');
    return reply.sendFile('index.html');
  });

  await app.ready();
  return app;
}
