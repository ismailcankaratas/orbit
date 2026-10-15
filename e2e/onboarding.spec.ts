import { combinedExpected } from '@orbit/test-fixtures';
import { expect, test, type Page } from '@playwright/test';
import { MONEY_LABEL_RE, WIDE_API, WIDE_UI, getJson, norm, parseTrNumber, readMerkez, sourceRoot, t, trCompact, trPct, trUsd } from './support/index.js';

// Stateful flow on the main server (:4450): consent -> scan -> demo -> real. Runs once, desktop viewport.
test.describe.configure({ mode: 'serial' });

/** Scene 01 readout value (exact digits for the small ones: requests / sessions). */
const readout = (page: Page, key: string) => page.locator('.scene-slot .mz-ro', { has: page.getByRole('heading', { name: t(key), exact: true }) }).locator('.mz-ro-val');

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
  await expect(page.locator('[data-shell]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('navigation')).toHaveCount(0); // no sidebar / page nav after consent
  await expect.poll(async () => (await getJson(request, '/api/v1/status')).scan.state, { timeout: 30_000 }).toBe('idle');
  const status = await getJson(request, '/api/v1/status');
  expect(status.mode).toBe('real');
  expect(status.consentGranted).toBe(true);
  expect(status.scan.filesTotal).toBeGreaterThan(0);
  expect(status.scan.filesDone).toBe(status.scan.filesTotal);
  expect(JSON.stringify(status)).not.toContain(sourceRoot()); // absolute source path is never echoed

  // `/` redirects into Scene 01 (default range = last 30 days; the synthetic data is older, so use the wide range)
  await page.goto('/');
  await expect(page).toHaveURL(/\/bolum\/merkez/);
  await page.goto(`/?${WIDE_UI}`);
  await expect(page).toHaveURL(new RegExp(`/bolum/merkez\\?${WIDE_UI}`));
  await expect(readout(page, 'scene.merkez.ro.requests')).toBeVisible();

  // Scene 01 == fixtures == /api/v1/overview for the same query
  const ov = await getJson(request, `/api/v1/overview?${WIDE_API}`);
  const m = await readMerkez(page);
  const k = combinedExpected;
  const processedFixture = (k.uncachedInput ?? 0) + (k.output ?? 0) + (k.cacheRead ?? 0) + (k.cacheWrite5m ?? 0) + (k.cacheWrite1h ?? 0) + (k.unsplitCacheWrite ?? 0);
  expect(m.requests).toBe(k.uniqueRequests);
  expect(m.sessions).toBe(k.sessions);
  expect(m.requests).toBe(ov.kpis.uniqueRequests.value);
  expect(m.sessions).toBe(ov.kpis.sessions.value);
  expect(m.subagents).toBe(ov.kpis.subagents.value);
  expect(m.processedTokens, 'processed tokens (title attr, exact) vs API').toBe(ov.kpis.tokens.processed);
  expect(m.processedTokens, 'processed tokens vs fixture category sums').toBe(processedFixture);
  expect(m.sunText, 'sun shows the compact processed tokens').toBe(trCompact(ov.kpis.tokens.processed));
  expect(norm(m.cachePctText)).toBe(norm(trPct(ov.kpis.tokens.cacheRead / ov.kpis.tokens.processed, 1)));
  expect(m.usdText).toBe(trUsd(ov.kpis.cost.usdDecimal));
  // headline "<days> günde N proje, M oturum." from real metrics
  expect(m.headline).toContain(`${ov.kpis.projects.value} proje`);
  expect(m.headline).toContain(`${ov.kpis.sessions.value} oturum`);
  await expect(page.locator('.scene-slot')).toContainText(MONEY_LABEL_RE);
  await expect(page.locator('.scene-slot [data-readout="value"]')).toContainText('USD');
  await expect(page.locator('.scene-slot [data-readout="value"]')).toContainText('Pro/Max');
  await expect(page.locator('.badge.dataset-real')).toContainText(t('dataset.real'));
  expect(parseTrNumber(await readout(page, 'scene.merkez.ro.requests').innerText())).toBe(78);
});

test('demo switch shows a persistent Demo badge, never mixes real data, and switching back restores real', async ({ page, request }) => {
  await page.goto(`/bolum/merkez?${WIDE_UI}`);
  await expect(readout(page, 'scene.merkez.ro.requests')).toBeVisible();
  const realReq = parseTrNumber(await readout(page, 'scene.merkez.ro.requests').innerText());
  const realProjects = ((await getJson(request, `/api/v1/projects?${WIDE_API}`)).items as { label: string }[]).map((p) => p.label);
  expect(realProjects.length).toBeGreaterThan(0);

  await page.goto('/settings');
  await page.getByRole('radio', { name: new RegExp(t('dataset.demo')) }).click();
  const badge = page.locator('.badge.dataset-demo');
  await expect(badge).toContainText(t('dataset.demo'));
  await expect(page.getByTestId('demo-note')).toContainText(t('shell.demo.notice'));

  // persistent across routes and reload
  for (const route of ['/bolum/merkez', '/bolum/zaman', '/projects', '/agents', '/sessions', '/settings']) {
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
  await expect(page.locator('main table tbody tr').first()).toBeVisible(); // wait for the demo rows (no vacuous pass on a skeleton)
  const body = await page.locator('main table').innerText(); // project table only: the model filter legitimately lists model ids
  for (const l of realProjects) expect(body.includes(l), `real project label leaked into demo: ${l.slice(0, 20)}`).toBe(false);
  await page.goto(`/bolum/merkez?${WIDE_UI}`);
  await expect(readout(page, 'scene.merkez.ro.requests')).toBeVisible();
  expect(parseTrNumber(await readout(page, 'scene.merkez.ro.requests').innerText())).toBe(demoOv.kpis.uniqueRequests.value);
  expect(await page.locator('.scene-slot').innerText()).not.toContain(realProjects[0] as string);

  // back to real
  await page.goto('/settings');
  await page.getByRole('radio', { name: new RegExp(t('dataset.real')) }).click();
  await expect(page.locator('.badge.dataset-demo')).toHaveCount(0);
  await expect(page.locator('.badge.dataset-real')).toBeVisible();
  await page.goto(`/bolum/merkez?${WIDE_UI}`);
  await expect(readout(page, 'scene.merkez.ro.requests')).toBeVisible();
  expect(parseTrNumber(await readout(page, 'scene.merkez.ro.requests').innerText())).toBe(combinedExpected.uniqueRequests);
});
