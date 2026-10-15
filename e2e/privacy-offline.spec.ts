import { readFileSync } from 'node:fs';
import { CANARIES } from '@orbit/test-fixtures';
import { expect, test, type Page } from '@playwright/test';
import { ASK, CORE_ROUTES, MAIN, PHASE4_ROUTES, WIDE_API, WIDE_UI, ask, askCard, discover, failOnDialog, findPhase4Path, getJson, openScene, ready, t, tRe } from './support/index.js';

const LOCAL_SCHEMES = /^(data|blob|about):/;

function leaks(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(CANARIES.pattern)) found.add(m[0]);
  for (const s of [...CANARIES.secrets, CANARIES.injection]) if (text.includes(s)) found.add(s);
  if (text.includes('/Users/demo')) found.add('/Users/demo');
  return [...found];
}

async function visitAll(page: Page, onRoute?: (name: string) => Promise<void>): Promise<void> {
  const d = await discover(page.request);
  const routes = [...CORE_ROUTES];
  for (const r of PHASE4_ROUTES) {
    const p = await findPhase4Path(page, r.candidates);
    if (p) routes.push({ ...r, path: () => p });
  }
  for (const r of routes) {
    await page.goto(r.path(d));
    await ready(page);
    if (r.after) await r.after(page);
    await onRoute?.(r.name);
  }
}

test('every request during a full walkthrough stays on 127.0.0.1:4450; DOM and API bodies hold no canaries or home paths', async ({ page, context }) => {
  const urls: string[] = [];
  context.on('request', (r) => urls.push(r.url()));
  const apiLeaks: string[] = [];
  page.on('response', async (res) => {
    const u = res.url();
    if (!u.startsWith(`${MAIN}/api/v1/`) || u.includes('/events')) return;
    try {
      const body = await res.text();
      for (const l of leaks(body)) apiLeaks.push(`${new URL(u).pathname}: ${l}`);
    } catch { /* body unavailable (navigation aborted) */ }
  });
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const domLeaks: string[] = [];

  await visitAll(page, async (name) => {
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    for (const l of leaks(html)) domLeaks.push(`${name}: ${l}`);
  });
  // shell overlays + Orbit Ask (questions and commands) must not leave the origin or leak either
  await openScene(page);
  await page.keyboard.press('c');
  await expect(page.getByRole('dialog')).toBeVisible();
  for (const l of leaks(await page.evaluate(() => document.documentElement.outerHTML))) domLeaks.push(`catalog: ${l}`);
  await page.keyboard.press('Escape');
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  for (const q of ['kaç oturum', 'tahmini değer ne kadar', 'en çok kullanılan proje', 'hava nasıl']) {
    await ask(page, q);
    await expect(askCard(page)).toBeVisible();
    for (const l of leaks(await page.evaluate(() => document.documentElement.outerHTML))) domLeaks.push(`ask(${q.length}): ${l}`);
  }
  // open an agent drawer too
  await page.goto(`/agents?${WIDE_UI}`);
  await ready(page);
  await page.getByRole('button', { name: t('agents.view.list') }).click();
  await page.getByRole('button', { name: tRe('agent.inspect') }).first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  for (const l of leaks(await page.evaluate(() => document.documentElement.outerHTML))) domLeaks.push(`agent-drawer: ${l}`);

  const external = urls.filter((u) => !u.startsWith(`${MAIN}/`) && !LOCAL_SCHEMES.test(u));
  expect(external, 'requests that left http://127.0.0.1:4450').toEqual([]);
  expect(urls.length).toBeGreaterThan(10);
  expect(domLeaks).toEqual([]);
  expect(apiLeaks).toEqual([]);
  expect(pageErrors).toEqual([]);
});

const settled = (page: Page, label: string) =>
  expect
    // react-query retries before giving up, so poll: eventually real content or an explicit error state must replace the skeleton
    .poll(async () => (await page.locator('main [role="alert"]').count()) + (await page.locator('main table, main .card, main .state, main .hero').count()), { timeout: 20_000, message: `${label}: neither content nor error state while offline` })
    .toBeGreaterThan(0);

test('offline after load: warmed explorer views, shell and Ask keep rendering, never a crash', async ({ page, context }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const d = await discover(page.request);
  await openScene(page);
  // warm the data of the views we revisit offline (client-side navigation via Ask commands; a reload would need the network)
  for (const cmd of ['/gezgin projeler', '/gezgin ajanlar', '/gezgin oturumlar', '/gezgin raporlar']) {
    await ask(page, cmd);
    await ready(page);
  }
  await page.getByTestId('explorer-frame').getByRole('button', { name: t('shell.explorer.back') }).click(); // SPA nav: keeps the query cache
  await ready(page);
  await expect(page.locator(ASK)).toBeVisible();

  await context.setOffline(true);
  for (const cmd of ['/gezgin projeler', '/gezgin ajanlar', '/gezgin oturumlar', '/gezgin raporlar']) {
    await ask(page, cmd);
    await expect(page.getByTestId('explorer-frame')).toBeVisible();
    await expect(page.locator('h1').first()).toBeVisible();
    await settled(page, cmd);
    expect((await page.locator('#root').innerText()).trim().length, `${cmd} rendered something while offline`).toBeGreaterThan(0);
  }
  await page.getByTestId('explorer-frame').getByRole('button', { name: t('shell.explorer.back') }).click();
  await expect(page).toHaveURL(/\/bolum\/merkez/);
  await expect(page.locator('h1').first()).toBeVisible();
  await ask(page, '/yardım');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await ask(page, 'kaç oturum');
  await expect(askCard(page)).toBeVisible(); // answered or a designed error card, never a blank crash
  await expect(page.locator('[data-shell]')).toBeVisible();

  await context.setOffline(false);
  await page.goto(`/projects/${encodeURIComponent(d.topProject.id)}?${WIDE_UI}`);
  await ready(page);
  await expect(page.locator('h1').first()).toContainText(d.topProject.label.slice(0, 10));
  expect(pageErrors).toEqual([]);
});

// DEFECT PROBE (see reports/qa-delivery1.md, D-offline): react-query's default networkMode ('online') pauses a never-fetched
// query once the browser goes offline, so the explorer view shows its skeleton forever with no message, even though the
// 127.0.0.1 server is local. This test asserts the acceptable behaviour (content OR an explicit state) and fails today.
test('offline after load: a view that was never loaded shows content or an explicit state, not an endless skeleton', async ({ page, context }) => {
  await openScene(page);
  await context.setOffline(true);
  await ask(page, '/gezgin projeler');
  await expect(page.getByTestId('explorer-frame')).toBeVisible();
  await settled(page, '/gezgin projeler (cold)');
  await context.setOffline(false);
});

test('XSS: html/script payload labels never execute or become elements', async ({ page, request }) => {
  const dialogs = failOnDialog(page);
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const d = await discover(request);
  expect(d.htmlProject, 'html-payloads scenario project must be present').toBeTruthy();
  const pid = d.htmlProject!.id;
  const sessions = (await getJson(request, `/api/v1/sessions?${WIDE_API}&project=${encodeURIComponent(pid)}`)).items as { id: string }[];

  const paths = [
    `/projects?${WIDE_UI}`,
    `/projects/${encodeURIComponent(pid)}?${WIDE_UI}`,
    `/sessions?${WIDE_UI}`,
    ...sessions.map((s) => `/sessions/${encodeURIComponent(s.id)}?${WIDE_UI}`),
    `/agents?${WIDE_UI}`,
    `/bolum/merkez?${WIDE_UI}`,
  ];
  for (const p of paths) {
    await page.goto(p);
    await ready(page);
    if (p.startsWith('/agents')) {
      for (const view of ['agents.view.graph', 'agents.view.list']) {
        await page.getByRole('button', { name: t(view) }).click();
        await page.waitForTimeout(200);
      }
    }
    await page.waitForTimeout(500); // let a would-be onerror fire
    expect(await page.locator('main img[src="x"], main script, main [onerror]').count(), `${p}: injected element`).toBe(0);
  }
  expect(dialogs.opened).toEqual([]);
  expect(pageErrors).toEqual([]);
});

// ---- downloads
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function download(page: Page, href: string): Promise<string> {
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.evaluate((h) => {
      const a = document.createElement('a');
      a.href = h;
      a.download = '';
      document.body.append(a);
      a.click();
      a.remove();
    }, href),
  ]);
  const path = await dl.path();
  return readFileSync(path, 'utf8');
}

test('exports via Orbit Ask (/dışa-aktar csv|json) and /reports hold no canaries and neutralize formula cells', async ({ page }) => {
  await openScene(page);
  const askDownload = async (cmd: string): Promise<{ body: string; name: string }> => {
    const [dl] = await Promise.all([page.waitForEvent('download'), ask(page, cmd)]);
    return { body: readFileSync(await dl.path(), 'utf8'), name: dl.suggestedFilename() };
  };
  const csvAsk = await askDownload('/dışa-aktar csv');
  expect(csvAsk.name).toMatch(/\.csv$/);
  await expect(askCard(page)).toContainText('Pro/Max'); // export answer carries the money caveat
  const jsonAsk = await askDownload('/dışa-aktar json');
  expect(jsonAsk.name).toMatch(/\.json$/);
  await page.goto(`/reports?${WIDE_UI}`);
  await ready(page);
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: t('reports.downloadCsv') }).click()]);
  const csvReports = readFileSync(await dl.path(), 'utf8');

  const csv = await download(page, `/api/v1/exports?${WIDE_API}&format=csv`);
  const json = await download(page, `/api/v1/exports?${WIDE_API}&format=json`);
  for (const [name, body] of [['csv-ask', csvAsk.body], ['json-ask', jsonAsk.body], ['csv-reports', csvReports], ['csv', csv], ['json', json]] as const) {
    expect(leaks(body), name).toEqual([]);
    expect(body.length, name).toBeGreaterThan(50);
  }

  for (const [name, text] of [['csv', csv], ['csv-ask', csvAsk.body]] as const) {
    const rows = parseCsv(text);
    expect(rows.length, name).toBeGreaterThan(5);
    const cells = rows.slice(1).flat();
    // payload must actually be present (otherwise this check is vacuous) and be neutralized
    const formulaCells = cells.filter((c) => /HYPERLINK|^'?[+@-]/.test(c) && !/^-?\d+(\.\d+)?$/.test(c));
    const bad = cells.filter((c) => /^[=+@\t\r]/.test(c) || (/^-/.test(c) && !/^-?\d+(\.\d+)?$/.test(c)));
    expect(bad, `${name}: CSV cells a spreadsheet would evaluate`).toEqual([]);
    expect(formulaCells.length, `${name}: formula-names scenario cells present in export`).toBeGreaterThan(0);
  }

  for (const [name, text] of [['json', json], ['json-ask', jsonAsk.body]] as const) {
    const parsed = JSON.parse(text) as { meta: Record<string, unknown>; rows: unknown[] };
    expect(parsed.rows.length, name).toBeGreaterThan(0);
    expect(JSON.stringify(parsed.meta), name).toMatch(/estimate/i);
  }
});
