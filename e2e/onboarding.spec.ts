import { combinedExpected } from '@orbit/test-fixtures';
import { expect, test, type Page } from '@playwright/test';
import { WIDE_API, WIDE_UI, getJson, parseTrNumber, sourceRoot, t } from './support/index.js';

// Stateful flow on the main server (:4450): consent -> scan -> demo -> real. Runs once, desktop viewport.
test.describe.configure({ mode: 'serial' });

const kpi = (page: Page, key: string) => page.getByRole('region', { name: t(key) }).locator('.value');
const MONEY_LABEL = new RegExp(t('money.short').replace(/ \(USD\)$/, ''), 'i');

test('no scan happens before consent', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: t('onboard.scan') })).toBeVisible();
  await expect(page.getByRole('button', { name: t('onboard.demo') })).toBeVisible();
  await expect(page.getByText(t('onboard.noConsentNoScan'))).toBeVisible();
  await page.waitForTimeout(1500); // give any (buggy) auto-scan time to start
  const status = await getJson(request, '/api/v1/status');
  expect(status.mode).toBe('none');
  expect(status.consentGranted).toBe(false);
  expect(status.lastScanAt).toBeNull();
  expect(status.scan.state).toBe('idle');
  expect(status.scan.filesTotal).toBe(0);
  const ov = await getJson(request, `/api/v1/overview?${WIDE_API}`);
  expect(ov.coverage.sourceStatus).toBe('not_scanned');
  expect(ov.kpis.uniqueRequests.value).toBe(0);
  const projects = await getJson(request, `/api/v1/projects?${WIDE_API}`);
  expect(projects.items).toHaveLength(0);
});

test('consent with custom synthetic source path -> scan -> overview totals match fixtures', async ({ page, request }) => {
  await page.goto('/');
  await page.getByLabel(t('onboard.customPath')).fill(sourceRoot());
  await page.getByRole('button', { name: t('onboard.scan') }).click();
  // The synthetic tree scans in a few ms, so the transient progress bar is not reliably observable; the end state is.
  await expect(page.getByRole('navigation', { name: t('nav.main') })).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await getJson(request, '/api/v1/status')).scan.state, { timeout: 30_000 }).toBe('idle');
  const status = await getJson(request, '/api/v1/status');
  expect(status.mode).toBe('real');
  expect(status.consentGranted).toBe(true);
  expect(status.scan.filesTotal).toBeGreaterThan(0);
  expect(status.scan.filesDone).toBe(status.scan.filesTotal);
  expect(JSON.stringify(status)).not.toContain(sourceRoot()); // absolute source path is never echoed

  await page.goto(`/?${WIDE_UI}`);
  await expect(kpi(page, 'kpi.requests')).toBeVisible();
  expect(parseTrNumber(await kpi(page, 'kpi.requests').innerText())).toBe(combinedExpected.uniqueRequests);
  expect(parseTrNumber(await kpi(page, 'kpi.sessions').innerText())).toBe(combinedExpected.sessions);
  await expect(page.locator('main')).toContainText(MONEY_LABEL);
  await expect(kpi(page, 'kpi.value')).toContainText('USD');
  await expect(page.locator('.badge.dataset-real')).toContainText(t('dataset.real'));
});

test('demo switch shows a persistent Demo badge, never mixes real data, and switching back restores real', async ({ page, request }) => {
  await page.goto(`/?${WIDE_UI}`);
  const realReq = parseTrNumber(await kpi(page, 'kpi.requests').innerText());
  const realProjects = ((await getJson(request, `/api/v1/projects?${WIDE_API}`)).items as { label: string }[]).map((p) => p.label);
  expect(realProjects.length).toBeGreaterThan(0);

  await page.goto('/settings');
  await page.getByRole('radio', { name: new RegExp(t('dataset.demo')) }).click();
  const badge = page.locator('.badge.dataset-demo');
  await expect(badge).toContainText(t('dataset.demo'));
  await expect(page.getByText(t('dataset.demoBanner'))).toBeVisible();

  // persistent across routes and reload
  for (const route of ['/', '/projects', '/agents', '/sessions', '/settings']) {
    await page.goto(route.includes('?') ? route : `${route}?${WIDE_UI}`);
    await expect(badge, route).toBeVisible();
  }
  await page.reload();
  await expect(badge).toBeVisible();

  // real data must not leak into demo
  const demoOv = await getJson(request, `/api/v1/overview?${WIDE_API}`);
  expect(demoOv.mode).toBe('demo');
  expect(demoOv.kpis.uniqueRequests.value).toBeGreaterThan(0);
  expect(demoOv.kpis.uniqueRequests.value).not.toBe(realReq);
  const demoProjects = ((await getJson(request, `/api/v1/projects?${WIDE_API}`)).items as { label: string }[]).map((p) => p.label);
  expect(demoProjects.filter((l) => realProjects.includes(l))).toEqual([]);
  await page.goto(`/projects?${WIDE_UI}`);
  const body = await page.locator('main').innerText();
  for (const l of realProjects) expect(body.includes(l), `real project label leaked into demo: ${l.slice(0, 20)}`).toBe(false);
  await page.goto(`/?${WIDE_UI}`);
  expect(parseTrNumber(await kpi(page, 'kpi.requests').innerText())).toBe(demoOv.kpis.uniqueRequests.value);

  // back to real
  await page.goto('/settings');
  await page.getByRole('radio', { name: new RegExp(t('dataset.real')) }).click();
  await expect(page.locator('.badge.dataset-demo')).toHaveCount(0);
  await expect(page.locator('.badge.dataset-real')).toBeVisible();
  await page.goto(`/?${WIDE_UI}`);
  expect(parseTrNumber(await kpi(page, 'kpi.requests').innerText())).toBe(combinedExpected.uniqueRequests);
});
