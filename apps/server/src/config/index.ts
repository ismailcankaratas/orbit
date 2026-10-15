import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ServerConfig {
  /** Always loopback in v0.1. There is no override. */
  readonly host: '127.0.0.1';
  port: number;
  dataDir: string;
  dev: boolean;
  /** Only used after the user's explicit consent. */
  defaultSourceRoot: string;
  /** apps/web/dist, or null if it does not exist (checked by app). */
  webDist: string;
  version: string;
  /** Internal: max export rows before 413 EXPORT_TOO_LARGE (default 100,000). Not user-facing. */
  exportMaxRows?: number;
  /** Internal: SSE heartbeat period (default 25 s). */
  sseHeartbeatMs?: number;
}

/** apps/web/dist, resolved from either the bundled dist/main.js or the TS source tree. */
export function resolveWebDist(): string {
  const candidates = ['../../web/dist', '../../../web/dist'].map((rel) => resolve(fileURLToPath(new URL(rel, import.meta.url))));
  return candidates.find((c) => existsSync(join(c, 'index.html'))) ?? (candidates[0] as string);
}

export const APP_VERSION = '0.1.0-alpha.0';
export const DEFAULT_PORT = 4317;

export function defaultDataDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (env['ORBIT_DATA_DIR']) return resolve(env['ORBIT_DATA_DIR']);
  const home = homedir();
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Orbit');
  if (platform === 'win32') return join(env['APPDATA'] ?? join(home, 'AppData', 'Roaming'), 'Orbit');
  return join(env['XDG_DATA_HOME'] ?? join(home, '.local', 'share'), 'orbit');
}

export function parsePort(v: string | undefined): number {
  if (v === undefined || v === '') return DEFAULT_PORT;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 65535 ? n : DEFAULT_PORT;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Omit<ServerConfig, 'host'>> = {}): ServerConfig {
  return {
    host: '127.0.0.1',
    port: parsePort(env['ORBIT_PORT']),
    dataDir: defaultDataDir(env),
    dev: env['ORBIT_DEV'] === '1',
    defaultSourceRoot: join(homedir(), '.claude', 'projects'),
    webDist: resolveWebDist(),
    version: APP_VERSION,
    ...overrides,
  };
}

export const DATA_DIR_MARKER = '.orbit-data';

/** Startup error for a data directory Orbit refuses to adopt. The message never contains the absolute path. */
export class DataDirError extends Error {
  constructor(label: string) {
    super(
      `Refusing to use ${label} as the Orbit data directory: it is not empty and was not created by Orbit. ` +
        'Point ORBIT_DATA_DIR at a new or empty folder (Orbit writes a .orbit-data marker there).',
    );
    this.name = 'DataDirError';
  }
}

const chmod700 = (dir: string): void => {
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* best effort on platforms without POSIX modes */
  }
};

/**
 * Create the data directory (0700) with a `.orbit-data` marker. An existing directory is only chmod-ed when it carries
 * the marker, is empty, or already holds Orbit's own database; any other non-empty directory (for example $HOME set by
 * mistake) is refused so its permissions are never changed.
 */
export function ensureDataDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, DATA_DIR_MARKER), 'orbit\n', { mode: 0o600 });
    chmod700(dir);
    return;
  }
  if (!statSync(dir).isDirectory()) throw new DataDirError(redactPath(dir));
  if (existsSync(join(dir, DATA_DIR_MARKER))) {
    chmod700(dir);
    return;
  }
  const entries = readdirSync(dir);
  const ownsOrbitFiles = entries.includes('orbit.sqlite') || entries.includes('demo.sqlite');
  if (entries.length > 0 && !ownsOrbitFiles) throw new DataDirError(redactPath(dir));
  writeFileSync(join(dir, DATA_DIR_MARKER), 'orbit\n', { mode: 0o600 });
  chmod700(dir);
}

/** Redact a local path for display: home -> "~", outside home -> ".../<basename>". Never used for lookups. */
export function redactPath(p: string): string {
  const home = homedir();
  if (p === home) return '~';
  if (p.startsWith(home + sep)) return '~' + p.slice(home.length).split(sep).join('/');
  return '.../' + basename(p);
}
