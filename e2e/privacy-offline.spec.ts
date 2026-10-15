import { readFileSync } from 'node:fs';
import { CANARIES } from '@orbit/test-fixtures';
import { expect, test, type Page } from '@playwright/test';
import { CORE_ROUTES, MAIN, PHASE4_ROUTES, WIDE_API, WIDE_UI, discover, failOnDialog, findPhase4Path, getJson, navTo, ready, t, tRe } from './support/index.js';

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

test('offline after load: cached views keep rendering or show designed error states, never a crash', async ({ page, context }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const d = await discover(page.request);
  await page.goto(`/?${WIDE_UI}`);
  await ready(page);
  // warm the lazily-loaded chunks of two more routes so offline navigation can reuse them
  await page.goto(`/projects?${WIDE_UI}`);
  await ready(page);
  await page.goto(`/?${WIDE_UI}`);
  await ready(page);

  await context.setOffline(true);
  for (const key of ['nav.projects', 'nav.agents', 'nav.sessions', 'nav.settings', 'nav.overview']) {
    await navTo(page, key);
    await expect(page.locator('h1').first()).toBeVisible();
    // react-query retries before giving up, so poll: eventually real content or an explicit error state must replace the skeleton
    await expect
      .poll(async () => (await page.locator('main [role="alert"]').count()) + (await page.locator('main table, main .card, main .state, main .hero').count()), { timeout: 20_000, message: `${key}: neither content nor error state while offline` })
      .toBeGreaterThan(0);
    expect((await page.locator('#root').innerText()).trim().length, `${key} rendered something while offline`).toBeGreaterThan(0);
  }

  await context.setOffline(false);
  await page.goto(`/projects/${encodeURIComponent(d.topProject.id)}?${WIDE_UI}`);
  await ready(page);
  await expect(page.locator('h1').first()).toContainText(d.topProject.label.slice(0, 10));
  expect(pageErrors).toEqual([]);
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
    `/?${WIDE_UI}`,
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

test('exports (Overview CSV button + JSON) hold no canaries and neutralize formula cells', async ({ page }) => {
  await page.goto(`/?${WIDE_UI}`);
  await ready(page);

  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: t('action.downloadSummary') }).click()]);
  const csvFromButton = readFileSync(await dl.path(), 'utf8');
  expect(dl.suggestedFilename()).toMatch(/\.csv$/);

  const csv = await download(page, `/api/v1/exports?${WIDE_API}&format=csv`);
  const json = await download(page, `/api/v1/exports?${WIDE_API}&format=json`);
  for (const [name, body] of [['csv-button', csvFromButton], ['csv', csv], ['json', json]] as const) {
    expect(leaks(body), name).toEqual([]);
    expect(body.length, name).toBeGreaterThan(50);
  }

  const rows = parseCsv(csv);
  expect(rows.length).toBeGreaterThan(5);
  const cells = rows.slice(1).flat();
  // payload must actually be present (otherwise this check is vacuous) and be neutralized
  const formulaCells = cells.filter((c) => /HYPERLINK|^'?[+@-]/.test(c) && !/^-?\d+(\.\d+)?$/.test(c));
  const bad = cells.filter((c) => /^[=+@\t\r]/.test(c) || (/^-/.test(c) && !/^-?\d+(\.\d+)?$/.test(c)));
  expect(bad, 'CSV cells a spreadsheet would evaluate').toEqual([]);
  expect(formulaCells.length, 'formula-names scenario cells present in export').toBeGreaterThan(0);

  const parsed = JSON.parse(json) as { meta: Record<string, unknown>; rows: unknown[] };
  expect(parsed.rows.length).toBeGreaterThan(0);
  expect(JSON.stringify(parsed.meta)).toMatch(/estimate/i);
});
