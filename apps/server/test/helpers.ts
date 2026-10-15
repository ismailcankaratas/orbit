import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { loadConfig, type ServerConfig } from '../src/config/index.js';

export const HOST = 'localhost:4317';

export interface Env {
  root: string;
  dataDir: string;
  srcRoot: string;
  app: FastifyInstance;
  csrf: string;
  cleanup: () => Promise<void>;
}

export interface EnvOptions {
  clock?: () => number;
  dev?: boolean;
  forcePolling?: boolean;
  reuse?: { root: string; dataDir: string; srcRoot: string };
  /** Extra ServerConfig overrides (internal knobs such as exportMaxRows / sseHeartbeatMs). */
  config?: Partial<Omit<ServerConfig, 'host'>>;
}

export async function makeEnv(opts: EnvOptions = {}): Promise<Env> {
  const root = opts.reuse?.root ?? mkdtempSync(join(tmpdir(), 'orbit-test-'));
  const dataDir = opts.reuse?.dataDir ?? join(root, 'data');
  const srcRoot = opts.reuse?.srcRoot ?? join(root, 'src');
  mkdirSync(srcRoot, { recursive: true });
  const config = loadConfig({}, { dataDir, port: 4317, dev: opts.dev ?? false, webDist: join(root, 'no-web'), ...opts.config });
  const app = await buildApp({ config, serveWeb: false, ...(opts.forcePolling ? { forcePolling: true } : {}), ...(opts.clock ? { clock: opts.clock } : {}) });
  const csrf = app.csrfToken;
  return {
    root,
    dataDir,
    srcRoot,
    app,
    csrf,
    cleanup: async () => {
      await app.close();
      if (!opts.reuse) rmSync(root, { recursive: true, force: true });
    },
  };
}

export async function get<T = unknown>(env: Env, url: string, headers: Record<string, string> = {}): Promise<{ status: number; body: T; headers: Record<string, unknown>; raw: string }> {
  const res = await env.app.inject({ method: 'GET', url, headers: { host: HOST, ...headers } });
  let body: unknown = null;
  try {
    body = JSON.parse(res.body);
  } catch {
    body = null;
  }
  return { status: res.statusCode, body: body as T, headers: res.headers, raw: res.body };
}

export async function send<T = unknown>(
  env: Env,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: T; headers: Record<string, unknown> }> {
  const res = await env.app.inject({
    method,
    url,
    headers: { host: HOST, 'x-orbit-csrf': env.csrf, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
  });
  let body: unknown = null;
  try {
    body = JSON.parse(res.body);
  } catch {
    body = null;
  }
  return { status: res.statusCode, body: body as T, headers: res.headers };
}

/** Grant consent for srcRoot and complete one scan. */
export async function enableReal(env: Env, extra: Record<string, unknown> = {}): Promise<void> {
  const r = await send(env, 'PATCH', '/api/v1/settings', { consentGranted: true, sourceRoot: env.srcRoot, ...extra });
  if (r.status !== 200) throw new Error(`settings patch failed: ${r.status}`);
  await env.app.orbit.scan();
}

export const WIDE = 'from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z';
