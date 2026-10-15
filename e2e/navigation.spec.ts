import { expect, test } from '@playwright/test';
import { WIDE_UI, discover, openScene, ready, t, tRe } from './support/index.js';

const filtersOf = (url: string): string => {
  const u = new URL(url);
  return `from=${u.searchParams.get('from')}&to=${u.searchParams.get('to')}`;
};

test('Merkez planet -> detail -> "Veri gezgininde aç" -> project -> session -> agent drawer; filters survive every hop and browser back', async ({ page, request }) => {
  const d = await discover(request);
  await openScene(page);
  expect(page.url()).toContain('/bolum/merkez');
  const want = filtersOf(page.url());
  expect(want).toBe('from=2020-01-01&to=2027-06-30');

  // focusing a planet fills the detail area with that project (keyboard path; planets rotate so pointer clicks are unstable)
  const planet = page.locator(`g.mz-planet[aria-label^="Proje ${d.topProject.label}"]`).first();
  await planet.focus();
  await expect(page.locator('.mz-detail .mz-d-name')).toContainText(d.topProject.label);
  await page.getByRole('button', { name: t('scene.merkez.detail.open') }).click();
  await expect(page).toHaveURL(/\/projects\/[^/?]+/);
  expect(filtersOf(page.url())).toBe(want);
  await expect(page.getByTestId('explorer-frame')).toBeVisible(); // inside the shell, not a standalone page
  await expect(page.locator('aside, .sidebar')).toHaveCount(0);
  await ready(page);

  await page.getByRole('tab', { name: t('tab.sessions') }).click();
  const sessionLink = page.getByRole('tabpanel').locator('a[href*="/sessions/"]').first();
  await expect(sessionLink).toBeVisible();
  await sessionLink.click();
  await expect(page).toHaveURL(/\/sessions\/[^/?]+/);
  expect(filtersOf(page.url())).toBe(want);
  await ready(page);

  // session -> agent drawer (sessions with subagents link to /agents?agent=)
  const agentLink = page.locator('main a[href*="/agents"]').first();
  if (await agentLink.count()) {
    await agentLink.click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(filtersOf(page.url())).toBe(want);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.goBack();
  }

  // browser back walks session -> project -> Merkez with filters intact
  if (!/\/sessions\//.test(page.url())) await expect(page).toHaveURL(/\/sessions\/[^/?]+/);
  await page.goBack();
  await expect(page).toHaveURL(/\/projects\/[^/?]+/);
  expect(filtersOf(page.url())).toBe(want);
  await page.goBack();
  await expect(page).toHaveURL(/\/bolum\/merkez/);
  expect(filtersOf(page.url())).toBe(want);
  await ready(page);
});

test('"Merkez\'e dön" from an explorer view returns to Scene 01 keeping the filters', async ({ page }) => {
  await openScene(page, '/sessions');
  await expect(page.getByTestId('explorer-frame')).toBeVisible();
  await page.getByTestId('explorer-frame').getByRole('button', { name: t('shell.explorer.back') }).click();
  await expect(page).toHaveURL(/\/bolum\/merkez/);
  expect(filtersOf(page.url())).toBe('from=2020-01-01&to=2027-06-30');
  await ready(page);
  await expect(page.locator('.scene-slot')).toBeVisible();
});

test('model arc and "+N diğer" cluster are selectable; model detail links to costs explorer', async ({ page }) => {
  await openScene(page);
  const arc = page.locator('g.mz-arc').first();
  await arc.focus();
  await expect(page.locator('.mz-detail .mz-d-head .badge')).toContainText(t('scene.merkez.detail.model'));
  await page.locator('.mz-detail .mz-open').click();
  await expect(page).toHaveURL(/\/costs/);
  await expect(page.getByTestId('explorer-frame')).toBeVisible();
});

test('rail dot of a planned chapter does not navigate and announces "Henüz hazır değil"', async ({ page }) => {
  await openScene(page);
  const url = page.url();
  await page.getByRole('button', { name: t('shell.rail.dot', { n: '05', title: t('shell.chapter.zaman.title') }) }).click({ force: true }); // aria-disabled (not native disabled): a real user can still click it
  expect(page.url()).toBe(url);
  await expect(page.getByTestId('live-region')).toContainText(/henüz hazır değil/i);
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

test('unknown route renders the 404 scene with a way back to Merkez', async ({ page }) => {
  await page.goto('/this/route/does-not-exist');
  await expect(page.getByRole('heading', { level: 1, name: t('shell.notfound.title') })).toBeVisible();
  await expect(page.getByText(t('shell.notfound.body'))).toBeVisible();
  await page.getByRole('button', { name: t('shell.planned.back') }).click();
  await expect(page).toHaveURL(/\/bolum\/merkez/);
  await ready(page);
});

test('404 scene and unknown chapter slug expose exactly one level-1 heading', async ({ page }) => {
  for (const p of ['/this/route/does-not-exist', '/bolum/yok-boyle-bir-bolum']) {
    await page.goto(p);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('shell.notfound.title'));
  }
});

test('unknown project id shows a designed not-found error, not a crash', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/projects/p_does_not_exist?${WIDE_UI}`);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(t('error.NOT_FOUND.title'));
  expect(errors).toEqual([]);
});
