import { expect, test } from '@playwright/test';
import { WIDE_UI, discover, navTo, ready, t, tRe } from './support/index.js';

const filtersOf = (url: string): string => {
  const u = new URL(url);
  return `from=${u.searchParams.get('from')}&to=${u.searchParams.get('to')}`;
};

test('overview -> top project -> session, filters survive every hop and browser back', async ({ page, request }) => {
  const d = await discover(request);
  await page.goto(`/?${WIDE_UI}`);
  await ready(page);
  const want = filtersOf(page.url());
  expect(want).toBe('from=2020-01-01&to=2027-06-30');

  await page.locator('main ol a', { hasText: d.topProject.label }).first().click();
  await expect(page).toHaveURL(/\/projects\/[^/?]+/);
  expect(filtersOf(page.url())).toBe(want);
  await ready(page);

  await page.getByRole('tab', { name: t('tab.sessions') }).click();
  const sessionLink = page.getByRole('tabpanel').locator('a[href*="/sessions/"]').first();
  await expect(sessionLink).toBeVisible();
  await sessionLink.click();
  await expect(page).toHaveURL(/\/sessions\/[^/?]+/);
  expect(filtersOf(page.url())).toBe(want);
  await ready(page);

  await page.goBack();
  await expect(page).toHaveURL(/\/projects\/[^/?]+/);
  expect(filtersOf(page.url())).toBe(want);
  await page.goBack();
  await expect(page).toHaveURL(/\/\?/);
  expect(filtersOf(page.url())).toBe(want);
  await ready(page);

  // sidebar/menu navigation also carries the filters
  await navTo(page, 'nav.sessions');
  await expect(page).toHaveURL(/\/sessions/);
  expect(filtersOf(page.url())).toBe(want);
});

test('session -> agent drawer -> "Kaynak oturumu görüntüle" returns to the same session', async ({ page, request }) => {
  const d = await discover(request);
  expect(d.sessionWithAgent, 'synthetic data must contain a session with subagents').toBeTruthy();
  const sid = d.sessionWithAgent!.id;
  await page.goto(`/sessions/${encodeURIComponent(sid)}?${WIDE_UI}`);
  await ready(page);

  const agentLink = page.locator('main a[href*="/agents"]').first();
  await expect(agentLink).toBeVisible();
  await agentLink.click();
  await expect(page).toHaveURL(/\/agents\?.*agent=/);
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  const back = drawer.getByRole('link', { name: t('agent.viewSession') });
  await expect(back).toBeVisible();
  await back.click();
  await expect(page).toHaveURL(new RegExp(`/sessions/${encodeURIComponent(sid)}`));
  expect(filtersOf(page.url())).toBe('from=2020-01-01&to=2027-06-30');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('agents list: opening the drawer from the list, Escape closes it and keeps filters', async ({ page }) => {
  await page.goto(`/agents?${WIDE_UI}`);
  await ready(page);
  await page.getByRole('button', { name: t('agents.view.list') }).click();
  const inspect = page.getByRole('button', { name: tRe('agent.inspect') }).first();
  await inspect.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(filtersOf(page.url())).toBe('from=2020-01-01&to=2027-06-30');
  // read-only MVP: no agent-control buttons anywhere
  await expect(page.getByRole('button', { name: /(assign task|pause|stop agent|restart|görev ata|durdur|yeniden başlat)/i })).toHaveCount(0);
});

test('unknown route renders the 404 page with a way home', async ({ page }) => {
  await page.goto('/this/route/does-not-exist');
  await expect(page.getByText(t('notfound.title'), { exact: true })).toBeVisible();
  await expect(page.getByText(t('notfound.body'))).toBeVisible();
  await page.getByRole('link', { name: t('notfound.home') }).click();
  await expect(page).toHaveURL(/\/($|\?)/);
  await ready(page);
});

test('404 page exposes a level-1 heading (a11y: every page has exactly one h1)', async ({ page }) => {
  await page.goto('/this/route/does-not-exist');
  await expect(page.getByText(t('notfound.title'), { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
});

test('unknown project id shows a designed not-found error, not a crash', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/projects/p_does_not_exist?${WIDE_UI}`);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(t('error.NOT_FOUND.title'));
  expect(errors).toEqual([]);
});
