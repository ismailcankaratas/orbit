import { readFileSync } from 'node:fs';
import { CANARIES } from '@orbit/test-fixtures';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { WIDE_API, WIDE_UI, getJson, hasKey, ready, t } from './support/index.js';

// Timeline / Costs / Reports / Story Mode. Skipped (with the reason) until the Phase-4 UI + strings exist.
const LANDED = hasKey('nav.costs') && hasKey('story.title') && hasKey('costs.definePrice') && hasKey('reports.downloadCsv');
test.skip(!LANDED, 'Phase 4 UI strings (nav.costs, story.title, costs.definePrice, reports.downloadCsv) not in tr.json yet');

const csrf = async (request: APIRequestContext): Promise<string> => (await getJson(request, '/api/v1/session')).csrfToken;
async function clearOverrides(request: APIRequestContext): Promise<void> {
  await request.patch('/api/v1/settings', { data: { rateOverrides: [] }, headers: { 'x-orbit-csrf': await csrf(request) } });
}
const costTotal = async (request: APIRequestContext): Promise<string> => (await getJson(request, `/api/v1/costs?${WIDE_API}`)).cost?.usdDecimal ?? (await getJson(request, `/api/v1/costs?${WIDE_API}`)).kpis?.cost?.usdDecimal;

async function openNav(page: Page, key: string): Promise<void> {
  const menu = page.getByRole('button', { name: t('nav.openMenu') });
  if (await menu.isVisible()) {
    await menu.click();
    await page.getByRole('dialog').getByRole('link', { name: t(key) }).click();
  } else await page.getByRole('navigation', { name: t('nav.main') }).getByRole('link', { name: t(key) }).click();
}

test('timeline: reachable from the nav, renders without an error state', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/?${WIDE_UI}`);
  await ready(page);
  await openNav(page, 'nav.timeline');
  await expect(page).toHaveURL(/\/timeline/);
  await ready(page);
  await expect(page.locator('main [role="alert"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test.describe('costs', () => {
  test.afterEach(async ({ request }) => clearOverrides(request));

  test('shows unpriced models, coverage warning and the estimated-value label', async ({ page }) => {
    await clearOverrides(page.request);
    await page.goto(`/costs?${WIDE_UI}`);
    await ready(page);
    await expect(page.getByRole('heading', { name: t('costs.unpricedTitle') })).toBeVisible();
    await expect(page.getByRole('button', { name: t('costs.definePrice') }).first()).toBeVisible();
    await expect(page.getByRole('alert').filter({ hasText: /%/ }).first()).toBeVisible(); // coverage < 100% warning
    await expect(page.locator('main')).toContainText(new RegExp(t('money.short').replace(/ \(USD\)$/, ''), 'i'));
    await expect(page.locator('main')).toContainText(t('coverage.rateVersion'));
  });

  test('"Fiyat tanımla" opens the editor; add override changes the total; delete restores it', async ({ page, request }) => {
    await clearOverrides(request);
    const before = await costTotal(request);
    await page.goto(`/costs?${WIDE_UI}`);
    await ready(page);

    await page.getByRole('button', { name: t('costs.definePrice') }).first().click();
    const dlg = page.getByRole('dialog');
    await expect(dlg).toBeVisible();
    await expect(dlg.getByLabel(t('rates.modelId'))).not.toHaveValue(''); // prefilled with the unpriced model
    for (const k of ['tokens.uncachedInput', 'tokens.output', 'tokens.cacheRead', 'tokens.cacheWrite5m', 'tokens.cacheWrite1h']) await dlg.getByLabel(t(k)).fill('5');
    await dlg.getByRole('button', { name: t('action.save') }).click();
    await expect(dlg.getByText(t('rates.local')).first()).toBeVisible();

    await expect.poll(() => costTotal(request)).not.toBe(before);
    expect(Number(await costTotal(request))).toBeGreaterThan(Number(before));
    const ov = (await getJson(request, '/api/v1/settings')).rateOverrides as unknown[];
    expect(ov).toHaveLength(1);

    // delete via the editor
    await dlg.getByRole('button', { name: t('rates.delete') }).first().click();
    await expect.poll(() => costTotal(request)).toBe(before);
    expect((await getJson(request, '/api/v1/settings')).rateOverrides).toHaveLength(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: t('costs.unpricedTitle') })).toBeVisible();
  });
});

test.describe('reports', () => {
  test('CSV and JSON downloads are clean and labelled as estimates', async ({ page }) => {
    await page.goto(`/reports?${WIDE_UI}`);
    await ready(page);
    await expect(page.getByRole('list', { name: t('reports.included') })).toBeVisible();
    await expect(page.getByRole('list', { name: t('reports.excluded') })).toBeVisible();

    const [csvDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: t('reports.downloadCsv') }).click()]);
    const [jsonDl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: t('reports.downloadJson') }).click()]);
    expect(csvDl.suggestedFilename()).toMatch(/\.csv$/);
    expect(jsonDl.suggestedFilename()).toMatch(/\.json$/);
    const csv = readFileSync(await csvDl.path(), 'utf8');
    const json = readFileSync(await jsonDl.path(), 'utf8');
    for (const body of [csv, json]) {
      expect(body.match(CANARIES.pattern) ?? []).toEqual([]);
      for (const s of CANARIES.secrets) expect(body).not.toContain(s);
      expect(body).not.toContain('/Users/demo');
    }
    expect(csv.split(/\r?\n/)[0]).toMatch(/estimat/i);
    expect(JSON.parse(json).meta).toBeTruthy();
    for (const cell of csv.split(/\r?\n/).slice(1).flatMap((l) => l.split(','))) expect(/^[=+@]/.test(cell), `formula cell ${cell}`).toBe(false);
  });
});

test.describe('story mode', () => {
  const index = (page: Page) => page.getByTestId('story-index');

  test('keyboard navigation: right/left/End/Home, Escape exits', async ({ page }) => {
    await page.goto(`/reports/story?${WIDE_UI}`);
    await ready(page);
    await expect(page.getByTestId('slide-active')).toHaveCount(1);
    const total = Number((await index(page).innerText()).split('/')[1]);
    expect(total).toBeGreaterThanOrEqual(5);
    expect(total).toBeLessThanOrEqual(8);
    await expect(index(page)).toHaveText(`1 / ${total}`);
    await page.keyboard.press('ArrowRight');
    await expect(index(page)).toHaveText(`2 / ${total}`);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await expect(index(page)).toHaveText(`2 / ${total}`);
    await page.keyboard.press('End');
    await expect(index(page)).toHaveText(`${total} / ${total}`);
    await page.keyboard.press('Home');
    await expect(index(page)).toHaveText(`1 / ${total}`);
    await page.keyboard.press('End');
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/reports(\?|$)/);
    await expect(page).not.toHaveURL(/story/);
  });

  test('every slide is data-grounded: money slide carries the estimate caveat, each has a drilldown link', async ({ page }) => {
    await page.goto(`/reports/story?${WIDE_UI}`);
    await ready(page);
    const total = Number((await index(page).innerText()).split('/')[1]);
    let sawMoney = false;
    for (let i = 0; i < total; i++) {
      const slide = page.getByTestId('slide-active');
      await expect(slide.getByRole('link', { name: new RegExp(t('story.viewData')) })).toBeVisible();
      const text = await slide.innerText();
      if (/USD/.test(text) && new RegExp(t('money.short').replace(/ \(USD\)$/, ''), 'i').test(text)) sawMoney = true;
      expect(/ücret(lendirildi)?|charged|fatura/i.test(text) && !/değildir|not/i.test(text), `slide ${i + 1} must not claim a charge`).toBe(false);
      if (i < total - 1) await page.keyboard.press('ArrowRight');
    }
    expect(sawMoney, 'a slide shows the estimated API-equivalent value label').toBe(true);
  });
});
