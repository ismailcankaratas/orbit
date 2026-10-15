import { expect, test } from '@playwright/test';
import { WIDE_API, getJson } from './support/index.js';

// Direct API checks against the production server (:4450). Hostile headers must be refused for GET and SSE too.
const EVIL = 'http://evil.example';

test.describe('hostile origin / host / csrf', () => {
  for (const path of ['/api/v1/overview', '/api/v1/events', '/api/v1/status', '/api/v1/projects']) {
    test(`cross-origin Origin on GET ${path} -> 403`, async ({ request }) => {
      const res = await request.get(path, { headers: { Origin: EVIL } });
      expect(res.status()).toBe(403);
      expect(res.headers()['access-control-allow-origin']).toBeUndefined();
    });
  }

  test('Sec-Fetch-Site: cross-site GET -> 403', async ({ request }) => {
    const res = await request.get('/api/v1/overview', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    expect(res.status()).toBe(403);
  });

  test('Host: evil.com -> 403 (DNS rebinding)', async ({ request }) => {
    const res = await request.get('/api/v1/overview', { headers: { Host: 'evil.com' } });
    expect(res.status()).toBe(403);
    const res2 = await request.get('/api/v1/events', { headers: { Host: 'evil.com:4450' } });
    expect(res2.status()).toBe(403);
  });

  test('missing / wrong CSRF on PATCH /settings -> 403, valid token accepted (positive control)', async ({ request }) => {
    const none = await request.patch('/api/v1/settings', { data: { locale: 'tr' } });
    expect(none.status()).toBe(403);
    const wrong = await request.patch('/api/v1/settings', { data: { locale: 'tr' }, headers: { 'x-orbit-csrf': 'not-the-token' } });
    expect(wrong.status()).toBe(403);
    const { csrfToken } = await getJson(request, '/api/v1/session');
    const ok = await request.patch('/api/v1/settings', { data: { locale: 'tr' }, headers: { 'x-orbit-csrf': csrfToken } });
    expect(ok.status()).toBe(200);
  });

  test('mutating endpoints reject cross-origin even with valid CSRF token', async ({ request }) => {
    const { csrfToken } = await getJson(request, '/api/v1/session');
    for (const [method, path] of [['PATCH', '/api/v1/settings'], ['POST', '/api/v1/scan'], ['DELETE', '/api/v1/archive']] as const) {
      const res = await request.fetch(path, { method, headers: { Origin: EVIL, 'x-orbit-csrf': csrfToken }, data: method === 'PATCH' ? { locale: 'tr' } : undefined });
      expect(res.status(), `${method} ${path}`).toBe(403);
    }
  });

  test('preflight OPTIONS from a foreign origin is refused and never grants CORS', async ({ request }) => {
    const res = await request.fetch('/api/v1/settings', {
      method: 'OPTIONS',
      headers: { Origin: EVIL, 'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'x-orbit-csrf,content-type' },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.headers()['access-control-allow-origin']).toBeUndefined();
    expect(res.headers()['access-control-allow-methods']).toBeUndefined();
  });

  test('no access-control-allow-origin on any normal response, hardening headers present', async ({ request }) => {
    for (const path of ['/health', '/api/v1/status', `/api/v1/overview?${WIDE_API}`, '/api/v1/session', '/']) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      const h = res.headers();
      expect(h['access-control-allow-origin'], path).toBeUndefined();
      expect(h['x-content-type-options'], path).toBe('nosniff');
      expect(h['content-security-policy'], path).toContain("default-src 'self'");
      expect(h['content-security-policy'], path).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
    }
  });
});

test.describe('path traversal over HTTP', () => {
  for (const path of ['/%2e%2e/%2e%2e/package.json', '/..%2f..%2fpackage.json', '/api/v1/projects/..%2f..%2f..%2fetc%2fpasswd', '/assets/%2e%2e/%2e%2e/%2e%2e/package.json']) {
    test(`GET ${path} does not leak files`, async ({ request }) => {
      const res = await request.get(path);
      const body = await res.text();
      expect(body).not.toContain('orbit-claude-dashboard');
      expect(body).not.toContain('root:');
    });
  }
});
