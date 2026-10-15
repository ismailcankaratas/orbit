import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { SettingsDTO } from '@orbit/core';
import { writeScenario } from '@orbit/test-fixtures';
import { WIDE, enableReal, get, makeEnv, send, type Env } from './helpers.js';

let env: Env | undefined;
afterEach(async () => {
  await env?.cleanup();
  env = undefined;
});

describe('PATCH /settings validation', () => {
  it('rejects relative, non-existent and file paths, extra keys and bad values', async () => {
    env = await makeEnv();
    const file = join(env.root, 'afile.txt');
    writeFileSync(file, 'x');
    const bad: unknown[] = [
      { sourceRoot: 'relative/path' },
      { sourceRoot: '../etc' },
      { sourceRoot: join(env.root, 'does-not-exist') },
      { sourceRoot: file },
      { sourceRoot: '/tmp/a\0b' },
      { sourceRoot: '' },
      { unknownKey: 1 },
      { consentGranted: 'yes' },
      { watchIntervalMs: 100 },
      { watchIntervalMs: 999999 },
      { timezone: 'Mars/Phobos' },
      { locale: 'de' },
      { activeDataset: 'none' },
      { rateOverrides: [{ nope: true }] },
    ];
    for (const b of bad) {
      const r = await send(env, 'PATCH', '/api/v1/settings', b);
      expect(r.status, JSON.stringify(b)).toBe(400);
      expect(JSON.stringify(r.body)).not.toContain(env.root);
    }
    const s = await get<SettingsDTO>(env, '/api/v1/settings');
    expect(s.body.consentGranted).toBe(false);
    expect(s.body.sourceIsDefault).toBe(true);
  });

  it('accepts a valid directory, canonicalizes it and never echoes the path', async () => {
    env = await makeEnv();
    const r = await send<SettingsDTO>(env, 'PATCH', '/api/v1/settings', { sourceRoot: env.srcRoot, watchIntervalMs: 3000, locale: 'en', timezone: 'America/New_York' });
    expect(r.status).toBe(200);
    expect(r.body.sourceIsDefault).toBe(false);
    expect(JSON.stringify(r.body)).not.toContain(env.root);
    expect(r.body.sourceLabel).toBe('.../src');
    expect(r.body.dataDirLabel).not.toContain(env.root);
    expect(r.body.watchIntervalMs).toBe(3000);
    const d = await send<SettingsDTO>(env, 'PATCH', '/api/v1/settings', { sourceRoot: 'default' });
    expect(d.body.sourceIsDefault).toBe(true);
  });

  it('applies user rate overrides and re-prices everything', async () => {
    env = await makeEnv();
    await writeScenario('unknown-model', env.srcRoot);
    await enableReal(env);
    const before = (await get<{ kpis: { cost: { usdDecimal: string; unpricedRequestCount: number; rateScheduleVersion: string } } }>(env, `/api/v1/overview?${WIDE}`)).body.kpis.cost;
    expect(before.unpricedRequestCount).toBe(1);
    const override = {
      modelId: 'acme-unknown-model',
      displayName: 'Acme (local override)',
      aliases: [],
      effectiveFrom: '2020-01-01T00:00:00.000Z',
      effectiveTo: null,
      rates: { input: '1', output: '2', cacheRead: '0.1', cacheWrite5m: '1.25', cacheWrite1h: '2' },
      source: 'user_override',
    };
    const r = await send(env, 'PATCH', '/api/v1/settings', { rateOverrides: [override] });
    expect(r.status).toBe(200);
    const after = (await get<{ kpis: { cost: { usdDecimal: string; unpricedRequestCount: number; rateScheduleVersion: string } } }>(env, `/api/v1/overview?${WIDE}`)).body.kpis.cost;
    expect(after.unpricedRequestCount).toBe(0);
    expect(Number(after.usdDecimal)).toBeGreaterThan(Number(before.usdDecimal));
    expect(after.rateScheduleVersion).toContain('+local-');
    // overlapping overrides rejected
    const dup = await send(env, 'PATCH', '/api/v1/settings', { rateOverrides: [override, { ...override, effectiveFrom: '2021-01-01T00:00:00.000Z' }] });
    expect(dup.status).toBe(400);
    // clearing restores unpriced state
    await send(env, 'PATCH', '/api/v1/settings', { rateOverrides: [] });
    expect((await get<{ kpis: { cost: { unpricedRequestCount: number } } }>(env, `/api/v1/overview?${WIDE}`)).body.kpis.cost.unpricedRequestCount).toBe(1);
  });

  it('changing sourceRoot resets the real DB scan state', async () => {
    env = await makeEnv();
    await writeScenario('baseline', env.srcRoot);
    await enableReal(env);
    const other = join(env.root, 'other');
    mkdirSync(other);
    await send(env, 'PATCH', '/api/v1/settings', { sourceRoot: other });
    await env.app.orbit.scan();
    const o = await get<{ kpis: { uniqueRequests: { value: number } }; coverage: { sourceStatus: string } }>(env, `/api/v1/overview?${WIDE}`);
    expect(o.body.kpis.uniqueRequests.value).toBe(0);
    expect(o.body.coverage.sourceStatus).toBe('empty');
  });

  it('reports a missing source root as SOURCE_NOT_FOUND scan error', async () => {
    env = await makeEnv();
    await send(env, 'PATCH', '/api/v1/settings', { consentGranted: true, sourceRoot: env.srcRoot });
    await env.app.orbit.scan();
    const { rmSync } = await import('node:fs');
    rmSync(env.srcRoot, { recursive: true });
    await env.app.orbit.scan();
    const st = await get<{ scan: { state: string; lastError: string | null } }>(env, '/api/v1/status');
    expect(st.body.scan.state).toBe('error');
    expect(st.body.scan.lastError).toBe('SOURCE_NOT_FOUND');
  });
});
