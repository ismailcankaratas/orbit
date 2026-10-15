import { request as httpRequest } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { HOST, get, makeEnv, send, type Env } from './helpers.js';

let env: Env | undefined;
afterEach(async () => {
  await env?.cleanup();
  env = undefined;
});

const codeOf = (b: unknown): string => (b as { error: { code: string } }).error.code;

describe('loopback trust boundary', () => {
  it('rejects bad Host headers on every route (DNS rebinding)', async () => {
    env = await makeEnv();
    for (const host of ['evil.com', 'localhost', 'localhost:9999', '127.0.0.1:80', '0.0.0.0:4317', 'localhost:4317.evil.com', 'evil.com:4317']) {
      for (const url of ['/health', '/api/v1/overview', '/api/v1/session', '/api/v1/events', '/']) {
        const r = await env.app.inject({ method: 'GET', url, headers: { host } });
        expect(r.statusCode, `${host} ${url}`).toBe(403);
        expect(JSON.parse(r.body).error.code).toBe('CROSS_ORIGIN_DENIED');
      }
    }
    for (const host of ['localhost:4317', '127.0.0.1:4317', 'LOCALHOST:4317']) {
      expect((await env.app.inject({ method: 'GET', url: '/health', headers: { host } })).statusCode).toBe(200);
    }
  });

  it('rejects foreign Origin on GET, SSE and mutations', async () => {
    env = await makeEnv();
    for (const origin of ['https://evil.com', 'http://localhost:9999', 'null', 'http://127.0.0.1:4317.evil.com']) {
      expect((await get(env, '/api/v1/overview', { origin })).status, origin).toBe(403);
      expect((await get(env, '/api/v1/session', { origin })).status, origin).toBe(403);
      expect((await get(env, '/api/v1/events', { origin })).status, origin).toBe(403);
      const m = await send(env, 'PATCH', '/api/v1/settings', { locale: 'en' }, { origin });
      expect(m.status, origin).toBe(403);
      expect(codeOf(m.body)).toBe('CROSS_ORIGIN_DENIED');
    }
    expect((await get(env, '/api/v1/session', { origin: 'http://localhost:4317' })).status).toBe(200);
    expect((await get(env, '/api/v1/session', { origin: 'http://127.0.0.1:4317' })).status).toBe(200);
  });

  it('rejects cross-site and same-site fetch metadata', async () => {
    env = await makeEnv();
    expect((await get(env, '/api/v1/overview', { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await get(env, '/api/v1/events', { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await get(env, '/api/v1/overview', { 'sec-fetch-site': 'same-site' })).status).toBe(403);
    expect((await get(env, '/api/v1/overview', { 'sec-fetch-site': 'same-origin' })).status).toBe(200);
    expect((await get(env, '/api/v1/overview', { 'sec-fetch-site': 'none' })).status).toBe(200);
  });

  it('requires the CSRF token on every mutation', async () => {
    env = await makeEnv();
    const base = { host: HOST, 'content-type': 'application/json' };
    const cases: [string, string, unknown][] = [
      ['POST', '/api/v1/scan', {}],
      ['PATCH', '/api/v1/settings', { locale: 'en' }],
      ['PUT', '/api/v1/projects/p_000000000000/alias', { alias: 'x' }],
      ['DELETE', '/api/v1/archive', { confirm: 'DELETE_ORBIT_DATA' }],
    ];
    for (const [method, url, body] of cases) {
      const none = await env.app.inject({ method: method as 'POST', url, headers: base, payload: JSON.stringify(body) });
      expect(none.statusCode, `${method} ${url}`).toBe(403);
      expect(JSON.parse(none.body).error.code).toBe('CSRF_REQUIRED');
      const wrong = await env.app.inject({ method: method as 'POST', url, headers: { ...base, 'x-orbit-csrf': 'x'.repeat(64) }, payload: JSON.stringify(body) });
      expect(wrong.statusCode).toBe(403);
    }
    const settingsStill = await get<{ locale: string }>(env, '/api/v1/settings');
    expect(settingsStill.body.locale).toBe('tr');
    const session = await get<{ csrfToken: string }>(env, '/api/v1/session');
    expect(session.body.csrfToken).toBe(env.csrf);
    expect(env.csrf).toMatch(/^[0-9a-f]{64}$/);
    expect((await send(env, 'PATCH', '/api/v1/settings', { locale: 'en' })).status).toBe(200);
  });

  it('never emits CORS headers and always sends hardened headers', async () => {
    env = await makeEnv();
    const responses = [
      await env.app.inject({ method: 'GET', url: '/health', headers: { host: HOST, origin: 'http://localhost:4317' } }),
      await env.app.inject({ method: 'GET', url: '/health', headers: { host: 'evil.com', origin: 'https://evil.com' } }),
      await env.app.inject({ method: 'OPTIONS', url: '/api/v1/settings', headers: { host: HOST, origin: 'https://evil.com', 'access-control-request-method': 'PATCH' } }),
      await env.app.inject({ method: 'GET', url: '/api/v1/nope', headers: { host: HOST } }),
      await env.app.inject({ method: 'GET', url: '/api/v1/overview?from=bad', headers: { host: HOST } }),
      await env.app.inject({ method: 'GET', url: '/some/spa/route', headers: { host: HOST } }),
    ];
    for (const r of responses) {
      const h = r.headers;
      expect(Object.keys(h).filter((k) => k.startsWith('access-control-'))).toEqual([]);
      expect(h['content-security-policy']).toBe(
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      );
      expect(h['x-content-type-options']).toBe('nosniff');
      expect(h['referrer-policy']).toBe('no-referrer');
      expect(h['x-frame-options']).toBe('DENY');
      expect(h['cross-origin-opener-policy']).toBe('same-origin');
      expect(h['cross-origin-resource-policy']).toBe('same-origin');
    }
    expect(responses[3]?.statusCode).toBe(404);
    expect(responses[4]?.statusCode).toBe(400);
  });

  it('errors are sanitized (no stack, no paths)', async () => {
    env = await makeEnv();
    const r = await get(env, '/api/v1/overview?from=2026-01-01&to=2025-01-01&tz=Nope/Zone');
    expect(r.status).toBe(400);
    expect(r.raw).not.toMatch(/at .*\(|node_modules|\/Users|\.ts:/);
    const big = await env.app.inject({ method: 'PATCH', url: '/api/v1/settings', headers: { host: HOST, 'x-orbit-csrf': env.csrf, 'content-type': 'application/json' }, payload: JSON.stringify({ sourceRoot: 'x'.repeat(300_000) }) });
    expect(big.statusCode).toBe(413);
    const badJson = await env.app.inject({ method: 'PATCH', url: '/api/v1/settings', headers: { host: HOST, 'x-orbit-csrf': env.csrf, 'content-type': 'application/json' }, payload: '{not json' });
    expect(badJson.statusCode).toBe(400);
  });

  it('dev mode additionally allows the Vite origin; production does not', async () => {
    env = await makeEnv();
    expect((await env.app.inject({ method: 'GET', url: '/health', headers: { host: 'localhost:5173' } })).statusCode).toBe(403);
    await env.cleanup();
    env = await makeEnv({ dev: true });
    expect((await env.app.inject({ method: 'GET', url: '/health', headers: { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173' } })).statusCode).toBe(200);
    expect((await env.app.inject({ method: 'GET', url: '/health', headers: { host: 'localhost:5173', origin: 'http://evil.com' } })).statusCode).toBe(403);
  });

  it('listens on 127.0.0.1 only and streams SSE events', async () => {
    env = await makeEnv();
    await env.app.listen({ host: '127.0.0.1', port: 0 });
    const addr = env.app.server.address();
    expect(addr && typeof addr === 'object' && addr.address).toBe('127.0.0.1');
    const port = (addr as { port: number }).port;

    const health = await new Promise<{ status: number; csp: string | undefined }>((resolve, reject) => {
      httpRequest({ host: '127.0.0.1', port, path: '/health' }, (res) => {
        res.resume();
        res.on('end', () => resolve({ status: res.statusCode ?? 0, csp: res.headers['content-security-policy'] as string | undefined }));
      })
        .on('error', reject)
        .end();
    });
    expect(health.status).toBe(200);
    expect(health.csp).toContain("default-src 'self'");

    // SSE: headers, hardening, event delivery, close on abort
    const chunks: string[] = [];
    const sse = await new Promise<{ status: number; type: string; csp: unknown; req: ReturnType<typeof httpRequest> }>((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port, path: '/api/v1/events' }, (res) => {
        res.setEncoding('utf8');
        res.on('data', (c: string) => chunks.push(c));
        resolve({ status: res.statusCode ?? 0, type: String(res.headers['content-type']), csp: res.headers['content-security-policy'], req });
      });
      req.on('error', reject);
      req.end();
    });
    expect(sse.status).toBe(200);
    expect(sse.type).toContain('text/event-stream');
    expect(sse.csp).toBeTruthy();
    env.app.orbit.notifyChanged(['p_abcdef012345']);
    await new Promise((r) => setTimeout(r, 150));
    const text = chunks.join('');
    expect(text).toContain('event: usage.updated');
    expect(text).toMatch(/"changedProjects":\["p_abcdef012345"\]/);
    sse.req.destroy();

    const foreign = await new Promise<number>((resolve, reject) => {
      httpRequest({ host: '127.0.0.1', port, path: '/api/v1/events', headers: { origin: 'https://evil.com' } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      })
        .on('error', reject)
        .end();
    });
    expect(foreign).toBe(403);
  });
});
