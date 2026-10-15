import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { Page, ProjectSummary, SettingsDTO } from '@orbit/core';
import { renderRequestLine, writeScenario } from '@orbit/test-fixtures';
import { DATA_DIR_MARKER, DataDirError, ensureDataDir } from '../src/config/index.js';
import { MIGRATIONS, Store } from '../src/db/index.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config/index.js';
import { isForbiddenSourceRoot } from '../src/security/sourceRoot.js';
import { enableReal, get, makeEnv, send, type Env } from './helpers.js';

let env: Env | undefined;
const tmps: string[] = [];
afterEach(async () => {
  await env?.cleanup();
  env = undefined;
  for (const t of tmps.splice(0)) rmSync(t, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'orbit-hard-'));
  tmps.push(d);
  return d;
};

const RLO = '‮';
const ZWSP = '​';
const LRI = '⁦';
const PDI = '⁩';
const BOM = '﻿';
const WJ = '⁠';

describe('F-04 invisible / bidi characters in labels', () => {
  it('strips them from cwd-derived labels and aliases', async () => {
    env = await makeEnv();
    const cwd = `/Users/demo/pro${RLO}ject${ZWSP}${LRI}-x${PDI}${BOM}${WJ}`;
    const proj = join(env.srcRoot, '-Users-demo-spoof');
    mkdirSync(proj, { recursive: true });
    writeFileSync(
      join(proj, 'spoof-session-1.jsonl'),
      renderRequestLine({ sessionId: 'spoof-session-1', messageId: 'msg_spoof_1', usage: { input: 1, output: 1 }, timestamp: '2026-09-12T10:00:00.000Z', cwd }) + '\n',
    );
    await enableReal(env);
    const list = (await get<Page<ProjectSummary>>(env, '/api/v1/projects?from=2000-01-01T00:00:00Z&to=2100-01-01T00:00:00Z')).body;
    expect(list.items).toHaveLength(1);
    const p = list.items[0] as ProjectSummary;
    expect(p.label).toBe('project-x');
    const put = await send<ProjectSummary>(env, 'PUT', `/api/v1/projects/${p.id}/alias`, { alias: `  gnp${RLO}e${ZWSP}.exe${BOM}${LRI}  ` });
    expect(put.status).toBe(200);
    expect(put.body.alias).toBe('gnpe.exe');
    // nothing invisible reaches the database either
    const rows = env.app.orbit.realStore().all<{ label: string; alias: string | null }>('SELECT label, alias FROM projects');
    for (const r of rows) expect(/\p{Cf}/u.test(r.label + (r.alias ?? ''))).toBe(false); // Cf = bidi, zero-width, BOM
    // an alias made only of invisible characters clears the alias
    const empty = await send<ProjectSummary>(env, 'PUT', `/api/v1/projects/${p.id}/alias`, { alias: `${RLO}${ZWSP}` });
    expect(empty.body.alias).toBeNull();
  });
});

describe('F-05 source root denylist', () => {
  it('rejects /, home, credential and system trees, symlinks to them, and Orbit data dir overlaps', async () => {
    env = await makeEnv();
    const home = homedir();
    const link = join(env.root, 'link-to-root');
    symlinkSync('/', link);
    const bad = [
      '/',
      home,
      join(home, '.ssh'),
      join(home, '.ssh', 'nested'),
      join(home, '.gnupg'),
      join(home, 'Library', 'Keychains'),
      '/etc',
      '/etc/ssl',
      '/private/etc',
      '/System',
      '/System/Library',
      env.dataDir,
      join(env.dataDir, 'sub'),
      env.root, // contains the data dir
      link,
    ];
    for (const sourceRoot of bad) {
      const r = await send<{ error: { code: string } }>(env, 'PATCH', '/api/v1/settings', { sourceRoot });
      expect(r.status, sourceRoot).toBe(400);
      expect(r.body.error.code, sourceRoot).toBe('SOURCE_NOT_ALLOWED');
      expect(JSON.stringify(r.body)).not.toContain(home);
    }
    const s = (await get<SettingsDTO>(env, '/api/v1/settings')).body;
    expect(s.sourceIsDefault).toBe(true);
    // a normal folder is accepted
    const ok = await send(env, 'PATCH', '/api/v1/settings', { sourceRoot: env.srcRoot });
    expect(ok.status).toBe(200);
  });

  it('pure policy: subfolders of home are fine, ancestors of home are not', () => {
    const policy = { dataDir: '/tmp/orbit-data-x', home: '/Users/someone' };
    expect(isForbiddenSourceRoot('/Users/someone/.claude/projects', policy)).toBe(false);
    expect(isForbiddenSourceRoot('/Users/someone', policy)).toBe(true);
    expect(isForbiddenSourceRoot('/Users', policy)).toBe(true);
    expect(isForbiddenSourceRoot('/Users/someone/.ssh/keys', policy)).toBe(true);
    expect(isForbiddenSourceRoot('/Users/someone/Library/Keychains', policy)).toBe(true);
    expect(isForbiddenSourceRoot('/tmp/orbit-data-x/inner', policy)).toBe(true);
    expect(isForbiddenSourceRoot('/tmp', policy)).toBe(true);
    expect(isForbiddenSourceRoot('/srv/transcripts', policy)).toBe(false);
  });
});

describe('F-07 project_dir minimization', () => {
  it('stores sha256(project folder) instead of the encoded cwd', async () => {
    env = await makeEnv();
    await writeScenario('baseline', env.srcRoot);
    await enableReal(env);
    const rows = env.app.orbit.realStore().all<{ project_dir: string; rel_path: string }>('SELECT project_dir, rel_path FROM source_files');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.project_dir).toMatch(/^[0-9a-f]{64}$/);
      const folder = r.rel_path.split('/')[0] as string;
      expect(r.project_dir).toBe(createHash('sha256').update(folder).digest('hex'));
      expect(r.project_dir).not.toContain('Users');
    }
  });

  it('migration 3 rewrites existing encoded folders to their hash', () => {
    const dir = tmp();
    const raw = new DatabaseSync(join(dir, 'orbit.sqlite'));
    raw.exec(MIGRATIONS[0] as string);
    raw.exec('CREATE TABLE schema_version (version INTEGER NOT NULL); INSERT INTO schema_version VALUES (1);');
    raw.exec(MIGRATIONS[1] as string);
    raw.exec('INSERT INTO schema_version VALUES (2)');
    raw.exec("INSERT INTO source_files(id, kind, rel_path, project_dir, session_id) VALUES ('f1','main','-Users-x-proj/s1.jsonl','-Users-x-proj','s1')");
    raw.close();
    const store = new Store('real', dir);
    const v = store.get<{ project_dir: string }>('SELECT project_dir FROM source_files');
    expect(v?.project_dir).toBe(createHash('sha256').update('-Users-x-proj').digest('hex'));
    expect(store.schemaVersion).toBe(MIGRATIONS.length);
    store.close();
  });
});

describe('F-08 data directory ownership', () => {
  const mode = (p: string): number => statSync(p).mode & 0o777;

  it('creates a new directory with the marker and 0700', () => {
    const d = join(tmp(), 'fresh');
    ensureDataDir(d);
    expect(existsSync(join(d, DATA_DIR_MARKER))).toBe(true);
    if (process.platform !== 'win32') expect(mode(d)).toBe(0o700);
  });

  it.skipIf(process.platform === 'win32')('adopts an empty directory and an Orbit directory from before the marker existed', () => {
    const empty = tmp();
    chmodSync(empty, 0o755);
    ensureDataDir(empty);
    expect(mode(empty)).toBe(0o700);
    expect(existsSync(join(empty, DATA_DIR_MARKER))).toBe(true);

    const legacy = tmp();
    writeFileSync(join(legacy, 'orbit.sqlite'), '');
    chmodSync(legacy, 0o755);
    ensureDataDir(legacy);
    expect(mode(legacy)).toBe(0o700);
  });

  it.skipIf(process.platform === 'win32')('refuses a non-empty foreign directory and never changes its permissions', () => {
    const foreign = tmp();
    writeFileSync(join(foreign, 'notes.txt'), 'mine');
    chmodSync(foreign, 0o755);
    let err: unknown;
    try {
      ensureDataDir(foreign);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DataDirError);
    expect((err as Error).message).toContain('ORBIT_DATA_DIR');
    expect((err as Error).message).not.toContain(foreign);
    expect(mode(foreign)).toBe(0o755);
    expect(existsSync(join(foreign, DATA_DIR_MARKER))).toBe(false);
  });

  it('buildApp fails fast for a foreign directory (e.g. HOME by mistake)', async () => {
    const foreign = tmp();
    writeFileSync(join(foreign, 'Documents.txt'), 'x');
    const cfg = loadConfig({}, { dataDir: foreign, port: 4317, webDist: join(foreign, 'nope') });
    await expect(buildApp({ config: cfg, serveWeb: false })).rejects.toBeInstanceOf(DataDirError);
    expect(readFileSync(join(foreign, 'Documents.txt'), 'utf8')).toBe('x');
  });

  it('a marked directory is re-secured', () => {
    const d = tmp();
    ensureDataDir(join(d, 'x'));
    if (process.platform !== 'win32') {
      chmodSync(join(d, 'x'), 0o755);
      ensureDataDir(join(d, 'x'));
      expect(mode(join(d, 'x'))).toBe(0o700);
    }
  });
});
