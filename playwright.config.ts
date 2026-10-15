import { cpSync, existsSync, mkdirSync, mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * Orbit E2E. Tests assume `npm run build` has already produced apps/web/dist and apps/server/dist.
 *
 * Two production servers (127.0.0.1 only) are started with fresh temp data dirs:
 *  - :4450 "main"  - mutated by e2e/onboarding.spec.ts (consent -> scan synthetic root), then used by every other spec.
 *  - :4451 "fresh" - never consented; only used to render the onboarding screen (a11y/layout) at both viewports.
 * The temp root is created once per run (env var is inherited by workers) and removed in global teardown.
 */
const root = (process.env.ORBIT_E2E_ROOT ??= mkdtempSync(join(tmpdir(), 'orbit-e2e-')));
const dataMain = join(root, 'data-main');
const dataFresh = join(root, 'data-fresh');
for (const d of [dataMain, dataFresh]) mkdirSync(d, { recursive: true, mode: 0o700 });

// Snapshot the built artifacts so a concurrent `npm run build` (vite empties dist/) cannot break a running suite.
// main.js resolves ../../web/dist relative to itself and its externals through node_modules, so mirror that layout.
const snap = join(root, 'snap');
if (!existsSync(snap)) {
  cpSync('apps/server/dist', join(snap, 'server', 'dist'), { recursive: true });
  cpSync('apps/web/dist', join(snap, 'web', 'dist'), { recursive: true });
  symlinkSync(join(process.cwd(), 'node_modules'), join(snap, 'node_modules'));
}
const serverMain = join(snap, 'server', 'dist', 'main.js');

export const MAIN_URL = 'http://127.0.0.1:4450';
export const FRESH_URL = 'http://127.0.0.1:4451';
process.env.ORBIT_E2E_MAIN_URL = MAIN_URL;
process.env.ORBIT_E2E_FRESH_URL = FRESH_URL;

const desktop = { viewport: { width: 1440, height: 900 } };
const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1, // both servers hold state; specs are order-dependent by design (onboarding first)
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  outputDir: 'test-results',
  use: {
    baseURL: MAIN_URL,
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Runs the stateful consent -> scan flow once, on desktop. Everything else depends on it.
    { name: 'onboarding', testMatch: /onboarding\.spec\.ts/, use: { browserName: 'chromium', ...desktop } },
    { name: 'chromium', testIgnore: /onboarding\.spec\.ts/, dependencies: ['onboarding'], use: { browserName: 'chromium', ...desktop } },
    { name: 'mobile', testIgnore: [/onboarding\.spec\.ts/, /security\.spec\.ts/], dependencies: ['onboarding'], use: { browserName: 'chromium', ...mobile } },
  ],
  webServer: [
    {
      command: `node ${serverMain}`,
      env: { ORBIT_PORT: '4450', ORBIT_DATA_DIR: dataMain },
      url: `${MAIN_URL}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: `node ${serverMain}`,
      env: { ORBIT_PORT: '4451', ORBIT_DATA_DIR: dataFresh },
      url: `${FRESH_URL}/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
