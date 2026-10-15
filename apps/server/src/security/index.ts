import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from '../errors.js';

export const CSP =
  "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

export interface SecurityContext {
  /** Current listening port (updated after listen when binding to port 0). */
  port: () => number;
  dev: boolean;
  csrfToken: string;
}

export function newCsrfToken(): string {
  return randomBytes(32).toString('hex');
}

export function allowedHosts(port: number, dev: boolean): Set<string> {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (dev) hosts.push('127.0.0.1:5173', 'localhost:5173');
  return new Set(hosts);
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function deny(reply: FastifyReply, err: HttpError): FastifyReply {
  return reply.code(err.status).send(err.toBody());
}

/**
 * Registers the loopback trust boundary: Host/Origin/Fetch-Metadata checks on every
 * request (GET and SSE included), CSRF token on mutations, hardened headers, no CORS.
 */
export function registerSecurity(app: FastifyInstance, ctx: SecurityContext): void {
  app.addHook('onRequest', (req: FastifyRequest, reply: FastifyReply, done) => {
    reply.header('Content-Security-Policy', CSP);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('Cache-Control', 'no-store');

    const hosts = allowedHosts(ctx.port(), ctx.dev);
    const host = (req.headers.host ?? '').toLowerCase();
    const crossOrigin = new HttpError(403, 'CROSS_ORIGIN_DENIED', 'Cross-origin request denied.');
    if (!hosts.has(host)) {
      deny(reply, crossOrigin);
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined) {
      const ok = typeof origin === 'string' && [...hosts].some((h) => origin.toLowerCase() === `http://${h}`);
      if (!ok) {
        deny(reply, crossOrigin);
        return;
      }
    }
    const site = req.headers['sec-fetch-site'];
    if (site === 'cross-site' || site === 'same-site') {
      deny(reply, crossOrigin);
      return;
    }
    if (MUTATING.has(req.method)) {
      const token = req.headers['x-orbit-csrf'];
      if (typeof token !== 'string' || !safeEqual(token, ctx.csrfToken)) {
        deny(reply, new HttpError(403, 'CSRF_REQUIRED', 'A valid CSRF token is required for this request.'));
        return;
      }
    }
    done();
  });
}
