import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DiagnosticsDTO } from '@orbit/core';
import { getDefaultSchedule } from '@orbit/core';
import { renderRequestLine, writeAll, writeScenario } from '@orbit/test-fixtures';
import { Store } from '../src/db/index.js';
import { MAX_SSE_CLIENTS } from '../src/api/routes.js';
import { runScan } from '../src/scanner/scan.js';
import { WIDE, enableReal, get, makeEnv, type Env } from './helpers.js';

let env: Env | undefined;
afterEach(async () => {
  await env?.cleanup();
  env = undefined;
});

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await sleep(10);
}

describe('export size cap', () => {
  it('returns 413 EXPORT_TOO_LARGE past the configured cap and works under it', async () => {
    env = await makeEnv({ config: { exportMaxRows: 3 } });
    await writeAll(env.srcRoot);
    await enableReal(env);
    const big = await get<{ error: { code: string; retryable: boolean } }>(env, `/api/v1/exports?format=json&${WIDE}`);
    expect(big.status).toBe(413);
    expect(big.body.error.code).toBe('EXPORT_TOO_LARGE');
    const csv = await get(env, `/api/v1/exports?format=csv&${WIDE}`);
    expect(csv.status).toBe(413);
    // a narrow period fits
    const small = await get(env, '/api/v1/exports?format=json&from=2000-01-01T00:00:00Z&to=2000-01-02T00:00:00Z');
    expect(small.status).toBe(200);
  });

  it('defaults to 100,000 rows', async () => {
    env = await makeEnv();
    await writeScenario('baseline', env.srcRoot);
    await enableReal(env);
    expect((await get(env, `/api/v1/exports?format=json&${WIDE}`)).status).toBe(200);
  });
});

function sse(port: number): Promise<{ res: IncomingMessage; chunks: string[]; destroy: () => void }> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    const req = httpRequest({ host: '127.0.0.1', port, path: '/api/v1/events' }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (c: string) => chunks.push(c));
      resolve({ res, chunks, destroy: () => req.destroy() });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('SSE', () => {
  it('sends heartbeats on the (injectable) interval', async () => {
    env = await makeEnv({ config: { sseHeartbeatMs: 40 } });
    await env.app.listen({ host: '127.0.0.1', port: 0 });
    const port = (env.app.server.address() as { port: number }).port;
    const c = await sse(port);
    await until(() => (c.chunks.join('').match(/: heartbeat/g) ?? []).length >= 3, 2000);
    expect((c.chunks.join('').match(/: heartbeat/g) ?? []).length).toBeGreaterThanOrEqual(3);
    c.destroy();
  });

  it('does not leak subscribers, sockets or timers over 50 connect/disconnect cycles', async () => {
    env = await makeEnv({ config: { sseHeartbeatMs: 20 } });
    await env.app.listen({ host: '127.0.0.1', port: 0 });
    const port = (env.app.server.address() as { port: number }).port;
    const rt = env.app.orbit;
    const timersBefore = process.getActiveResourcesInfo().filter((x) => x === 'Timeout').length;
    for (let i = 0; i < 50; i++) {
      const c = await sse(port);
      await until(() => c.chunks.length > 0);
      if (i % 2 === 0) rt.notifyChanged([]);
      c.destroy();
    }
    await until(() => rt.listenerCount() === 0);
    expect(rt.listenerCount()).toBe(0);
    const connections = (): Promise<number> => new Promise((r) => env?.app.server.getConnections((_e, n) => r(n)));
    for (let i = 0; i < 100 && (await connections()) > 0; i++) await sleep(10);
    expect(await connections()).toBe(0);
    // heartbeat timers are cleared: no growth in active timers (allow 2 for unrelated runtime timers)
    await sleep(60);
    const timersAfter = process.getActiveResourcesInfo().filter((x) => x === 'Timeout').length;
    expect(timersAfter).toBeLessThanOrEqual(timersBefore + 2);
    expect(rt.listenerCount()).toBe(0);
    expect(env.app.server.listenerCount('request')).toBeLessThanOrEqual(1);
  });

  it(`caps concurrent clients at ${MAX_SSE_CLIENTS} with 503 RATE_LIMITED, and frees slots on disconnect`, async () => {
    env = await makeEnv();
    await env.app.listen({ host: '127.0.0.1', port: 0 });
    const port = (env.app.server.address() as { port: number }).port;
    const open: Awaited<ReturnType<typeof sse>>[] = [];
    for (let i = 0; i < MAX_SSE_CLIENTS; i++) {
      const c = await sse(port);
      expect(c.res.statusCode).toBe(200);
      open.push(c);
    }
    const over = await sse(port);
    expect(over.res.statusCode).toBe(503);
    await until(() => over.chunks.join('').includes('RATE_LIMITED'), 1000);
    const body = JSON.parse(over.chunks.join('')) as { error: { code: string; retryable: boolean } };
    expect(body.error.code).toBe('RATE_LIMITED');
    expect(body.error.retryable).toBe(true);
    (open.pop() as (typeof open)[number]).destroy();
    await until(() => env?.app.orbit.listenerCount() === MAX_SSE_CLIENTS - 1);
    const again = await sse(port);
    expect(again.res.statusCode).toBe(200);
    again.destroy();
    for (const c of open) c.destroy();
  });
});

describe('oversized / malformed requests (F-11)', () => {
  it('answers a 431 in the Orbit error shape with hardening headers', async () => {
    env = await makeEnv();
    await env.app.listen({ host: '127.0.0.1', port: 0 });
    const port = (env.app.server.address() as { port: number }).port;
    const raw = await new Promise<string>((resolve, reject) => {
      const s = connect({ host: '127.0.0.1', port }, () => {
        s.write(`GET /health HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nX-Big: ${'a'.repeat(70_000)}\r\n\r\n`);
      });
      let data = '';
      s.setEncoding('utf8');
      s.on('data', (c: string) => (data += c));
      s.on('end', () => resolve(data));
      s.on('close', () => resolve(data));
      s.on('error', reject);
    });
    expect(raw).toMatch(/^HTTP\/1\.1 431 /);
    expect(raw.toLowerCase()).toContain('content-security-policy:');
    const body = JSON.parse(raw.slice(raw.indexOf('\r\n\r\n') + 4)) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('INVALID_FILTER');
    expect(JSON.stringify(body)).not.toContain('aaaa');
  });
});

describe('scan robustness', () => {
  it('a file deleted between discovery and read is counted and the scan still completes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orbit-vanish-'));
    try {
      const src = join(root, 'src');
      const data = join(root, 'data');
      mkdirSync(src, { recursive: true });
      mkdirSync(data, { recursive: true });
      await writeScenario('multiple-children', src);
      const store = new Store('real', data);
      let victim = '';
      const res = await runScan({
        store,
        root: src,
        archive: true,
        schedule: getDefaultSchedule(),
        hooks: {
          afterDiscovery: (sources) => {
            const s = sources.find((x) => x.kind === 'agent') as (typeof sources)[number];
            victim = s.localPath;
            unlinkSync(s.localPath);
          },
        },
      });
      expect(victim).not.toBe('');
      expect(res.stats.discovery.unreadable).toBeGreaterThanOrEqual(1);
      expect(res.stats.filesScanned).toBeGreaterThan(0);
      expect(store.get<{ n: number }>('SELECT COUNT(*) AS n FROM requests')?.n).toBeGreaterThan(0);
      expect(store.get<{ n: number }>('SELECT COUNT(*) AS n FROM source_files')?.n).toBe(res.stats.filesScanned);
      // the next scan simply does not see it
      const again = await runScan({ store, root: src, archive: false, schedule: getDefaultSchedule() });
      expect(again.stats.discovery.unreadable).toBe(0);
      store.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('a file swapped for another file or a symlink after discovery is not ingested (post-open fstat / O_NOFOLLOW)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orbit-swap-'));
    try {
      const src = join(root, 'src');
      const data = join(root, 'data');
      const outside = join(root, 'outside');
      mkdirSync(src, { recursive: true });
      mkdirSync(data, { recursive: true });
      mkdirSync(outside, { recursive: true });
      await writeScenario('baseline', src);
      const canary = join(outside, 'canary.jsonl');
      writeFileSync(
        canary,
        renderRequestLine({ sessionId: 'CANARY_SWAP_SESSION', messageId: 'msg_canary_swap', model: 'canary-swap-model', usage: { input: 9, output: 9 }, timestamp: '2026-09-12T10:00:00.000Z' }) + '\n',
      );
      const store = new Store('real', data);
      const res = await runScan({
        store,
        root: src,
        archive: false,
        schedule: getDefaultSchedule(),
        hooks: {
          afterDiscovery: (sources) => {
            const mains = sources.filter((x) => x.kind === 'main');
            unlinkSync((mains[0] as (typeof mains)[number]).localPath);
            symlinkSync(canary, (mains[0] as (typeof mains)[number]).localPath);
          },
        },
      });
      expect(res.stats.discovery.unreadable).toBeGreaterThanOrEqual(1);
      expect(store.get<{ n: number }>("SELECT COUNT(*) AS n FROM requests WHERE model = 'canary-swap-model' OR session_id = 'CANARY_SWAP_SESSION'")?.n).toBe(0);
      store.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('symlinks in the root that point outside are never ingested and are reported', async () => {
    env = await makeEnv();
    await writeScenario('baseline', env.srcRoot);
    const outside = mkdtempSync(join(tmpdir(), 'orbit-outside-'));
    try {
      const outProj = join(outside, '-Users-evil-proj');
      mkdirSync(outProj, { recursive: true });
      const line = renderRequestLine({
        sessionId: 'CANARY_OUTSIDE_SESSION',
        messageId: 'msg_outside_canary',
        model: 'canary-outside-model',
        usage: { input: 7, output: 7 },
        timestamp: '2026-09-12T10:00:00.000Z',
        cwd: '/Users/evil/proj',
      });
      writeFileSync(join(outProj, 'CANARY_OUTSIDE_SESSION.jsonl'), line + '\n');
      // directory symlink and file symlink inside the root
      symlinkSync(outProj, join(env.srcRoot, '-Users-linked-dir'));
      const realProj = join(env.srcRoot, '-Users-demo-with-file-link');
      mkdirSync(realProj, { recursive: true });
      symlinkSync(join(outProj, 'CANARY_OUTSIDE_SESSION.jsonl'), join(realProj, 'file-link-session.jsonl'));
      await enableReal(env);
      const diag = (await get<DiagnosticsDTO>(env, '/api/v1/diagnostics')).body;
      expect(diag.discovery.symlinksSkipped).toBeGreaterThanOrEqual(2);
      const store = env.app.orbit.realStore();
      expect(store.get<{ n: number }>("SELECT COUNT(*) AS n FROM requests WHERE model = 'canary-outside-model'")?.n).toBe(0);
      expect(store.get<{ n: number }>("SELECT COUNT(*) AS n FROM sessions WHERE id LIKE 'CANARY%' OR id = 'file-link-session'")?.n).toBe(0);
      for (const f of ['orbit.sqlite', 'orbit.sqlite-wal']) {
        const p = join(env.dataDir, f);
        if (existsSync(p)) expect(readFileSync(p).includes('CANARY_OUTSIDE')).toBe(false);
      }
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe.skipIf(process.env['ORBIT_HEAVY_TESTS'] !== '1')('large single file memory bound (ORBIT_HEAVY_TESTS=1)', () => {
  it('ingests a ~200 MB main file with an RSS increase under 300 MB', async () => {
    env = await makeEnv();
    const proj = join(env.srcRoot, '-Users-demo-bigfile');
    mkdirSync(proj, { recursive: true });
    const file = join(proj, 'big-session-001.jsonl');
    const template = renderRequestLine({
      sessionId: 'big-session-001',
      messageId: '__ID__',
      usage: { input: 11, output: 22, cacheRead: 33 },
      timestamp: '2026-09-12T10:00:00.000Z',
      cwd: '/Users/demo/bigfile',
      text: 'x'.repeat(1800),
    });
    const target = 200 * 1024 * 1024;
    const fd = openSync(file, 'w');
    let written = 0;
    let n = 0;
    let batch: string[] = [];
    while (written < target) {
      batch.push(template.replaceAll('__ID__', `msg_big_${n++}`));
      if (batch.length === 500) {
        const buf = Buffer.from(batch.join('\n') + '\n');
        writeSync(fd, buf);
        written += buf.length;
        batch = [];
      }
    }
    closeSync(fd);
    const rssBase = process.memoryUsage().rss;
    let peak = rssBase;
    const timer = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().rss);
    }, 25);
    const t0 = Date.now();
    await enableReal(env);
    clearInterval(timer);
    peak = Math.max(peak, process.memoryUsage().rss);
    const deltaMb = (peak - rssBase) / 1024 / 1024;
    const secs = (Date.now() - t0) / 1000;
    process.stdout.write(`HEAVY file=${(written / 1048576).toFixed(0)}MB requests=${n} rssDelta=${deltaMb.toFixed(0)}MB scan=${secs.toFixed(1)}s\n`);
    const count = env.app.orbit.realStore().get<{ n: number }>('SELECT COUNT(*) AS n FROM requests')?.n;
    expect(count).toBe(n);
    expect(deltaMb).toBeLessThan(300);
  }, 600_000);
});
