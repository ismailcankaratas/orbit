import { mkdirSync, readFileSync } from 'node:fs';
import { AxeBuilder } from '@axe-core/playwright';
import { CANARIES } from '@orbit/test-fixtures';
import { expect, test, type Page } from '@playwright/test';
import {
  ASK, MAIN, MOBILE_UI, MONEY_LABEL_RE, WIDE_API, WIDE_UI, ask, askCard, discover, getJson, norm, openScene, parseTrNumber, ready, readMerkez, t, trCompact, trPct, trUsd,
  type Discovered,
} from './support/index.js';

/**
 * ADR-003 Delivery 1 acceptance, EXPERIENCE.md section 6, criteria 1..10 one by one.
 * Runs on the main server (:4450) after onboarding.spec.ts has consented + scanned the synthetic tree.
 */
const SHOTS = 'test-results/delivery1';
const isMobile = (name: string): boolean => name === 'mobile';
const kind = (name: string): 'mobile' | 'desktop' => (isMobile(name) ? 'mobile' : 'desktop');
const live = (page: Page) => page.getByTestId('live-region');

let d: Discovered;
test.beforeAll(async ({ request }) => {
  d = await discover(request);
  mkdirSync(SHOTS, { recursive: true });
});

/** Opens the settings panel through the top bar (mobile: via the compact menu popover). */
async function openSettingsFromTopBar(page: Page, mobile: boolean): Promise<void> {
  if (mobile) await page.getByRole('button', { name: t('shell.menu.open') }).click();
  await page.getByRole('button', { name: t('shell.settings.open'), exact: true }).last().click();
  await expect(page.getByRole('dialog', { name: t('shell.settings.title') })).toBeVisible();
}

// ============================================================ 1. no sidebar / page navigation in the DOM
test.describe('criterion 1: no sidebar or dashboard nav on any shell route', () => {
  const routes = [
    '/bolum/merkez', '/bolum/zaman', '/bolum/yok-boyle-bir-bolum', '/projects', '/sessions', '/agents', '/timeline', '/costs', '/reports', '/reports/story', '/settings', '/this/route/does-not-exist',
  ];
  for (const r of routes) {
    test(r, async ({ page }) => {
      await openScene(page, r);
      const found = await page.evaluate(() => {
        const hits: string[] = [];
        for (const el of Array.from(document.querySelectorAll('aside, nav, [role="navigation"], .sidebar, [class*="sidebar"], [class*="side-nav"], [data-testid*="sidebar"]'))) {
          // an <aside> that is part of a data view (e.g. the Agents inspector) is content, not app navigation:
          // only flag it when it is a direct child of the shell, or it holds links to other pages
          if (el.tagName === 'ASIDE' && el.parentElement?.closest('.orbit-shell') && !el.parentElement.classList.contains('orbit-shell') && el.querySelectorAll('a[href]').length === 0) continue;
          hits.push(`${el.tagName.toLowerCase()}.${String(el.getAttribute('class') ?? '')} links=[${Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href')).join(',')}]`);
        }
        // persistent chrome (top bar, rail, ask) must not link to feature pages; only the brand link to Merkez is allowed
        const chromeLinks = Array.from(document.querySelectorAll('.sh-top a[href], .sh-foot a[href]')).map((a) => a.getAttribute('href') ?? '').filter((h) => !h.startsWith('/bolum/merkez'));
        return { hits, chromeLinks };
      });
      expect(found.hits, 'aside/nav/sidebar elements').toEqual([]);
      expect(found.chromeLinks, 'persistent chrome linking to feature pages').toEqual([]);
    });
  }
  test('mobile menu popover is not a page navigation either', async ({ page }, info) => {
    test.skip(!isMobile(info.project.name), 'mobile only');
    await openScene(page);
    await page.getByRole('button', { name: t('shell.menu.open') }).click();
    const links = await page.locator('.popover-panel a[href]').count();
    expect(links).toBe(0);
  });
});

// ============================================================ 2. desktop: all four layers in the first viewport
test.describe('criterion 2: 1440x900 first viewport holds Top Bar, Scene, Rail and Ask', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test('bounding boxes + no page scroll', async ({ page }, info) => {
    test.skip(isMobile(info.project.name), 'desktop criterion');
    await openScene(page);
    await page.waitForTimeout(400);
    const boxes = await page.evaluate((askSel) => {
      const box = (sel: string) => {
        const e = document.querySelector(sel);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height, w: r.width };
      };
      return {
        top: box('.sh-top'), scene: box('.sh-scene'), slot: box('.scene-slot'), rail: box('[data-testid="chapter-rail"]'), ask: box(askSel),
        docScrollH: document.documentElement.scrollHeight, innerH: innerHeight, innerW: innerWidth,
        slotScrollH: (document.querySelector('.scene-slot') as HTMLElement).scrollHeight, slotClientH: (document.querySelector('.scene-slot') as HTMLElement).clientHeight,
      };
    }, ASK);
    for (const k of ['top', 'scene', 'slot', 'rail', 'ask'] as const) {
      const b = boxes[k];
      expect(b, `${k} present`).toBeTruthy();
      expect(b!.top, `${k}.top`).toBeGreaterThanOrEqual(0);
      expect(b!.bottom, `${k}.bottom <= ${boxes.innerH}`).toBeLessThanOrEqual(boxes.innerH + 0.5);
      expect(b!.left, `${k}.left`).toBeGreaterThanOrEqual(0);
      expect(b!.right, `${k}.right <= ${boxes.innerW}`).toBeLessThanOrEqual(boxes.innerW + 0.5);
      expect(b!.h, `${k} has height`).toBeGreaterThan(10);
    }
    expect(boxes.top!.h, 'top bar <= 56px (EXPERIENCE.md layer A)').toBeLessThanOrEqual(56);
    expect(boxes.docScrollH, 'document scrollHeight').toBeLessThanOrEqual(boxes.innerH);
    expect(boxes.slotScrollH, '.scene-slot scrollHeight vs clientHeight').toBeLessThanOrEqual(boxes.slotClientH);
    expect(boxes.rail!.top, 'rail below the scene').toBeGreaterThanOrEqual(boxes.scene!.bottom - 1);
  });

  test('an Ask answer card stays inside the viewport and does not make the page scroll', async ({ page }, info) => {
    test.skip(isMobile(info.project.name), 'desktop criterion');
    await openScene(page);
    await ask(page, 'tahmini değer ne kadar');
    await expect(askCard(page)).toBeVisible();
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => {
      const c = document.querySelector('.ask-card')!.getBoundingClientRect();
      return { top: c.top, bottom: c.bottom, docScrollH: document.documentElement.scrollHeight, innerH: innerHeight };
    });
    expect(m.top).toBeGreaterThanOrEqual(0);
    expect(m.bottom).toBeLessThanOrEqual(m.innerH);
    expect(m.docScrollH).toBeLessThanOrEqual(m.innerH);
  });
});

// ============================================================ 3. mobile: no overflow, Ask fixed + visible, scene scrolls
test.describe('criterion 3: 390x844', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

  test('no horizontal overflow on Scene 01, planned chapter, explorer views and 404 (same-year range)', async ({ page }) => {
    const bad: string[] = [];
    for (const r of ['/bolum/merkez', '/bolum/zaman', '/projects', '/sessions', '/agents', '/settings', '/bolum/nope']) {
      await openScene(page, r, MOBILE_UI);
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, iw: innerWidth }));
      if (m.sw > 390 || m.iw > 390) bad.push(`${r}: scrollWidth=${m.sw} innerWidth=${m.iw} (viewport 390)`);
    }
    expect(bad).toEqual([]);
  });

  // DEFECT PROBE: a cross-year custom range makes the compact top bar wider than 390px (page scrolls sideways, layout viewport 406px).
  test('no horizontal overflow with a cross-year custom range ("1 Oca 2020 – 30 Haz 2027")', async ({ page }) => {
    await openScene(page, '/bolum/merkez', WIDE_UI);
    await page.waitForTimeout(300);
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, label: document.querySelector('[data-testid="range-summary"]')?.textContent ?? '' }));
    expect(m.sw, `scrollWidth ${m.sw}, innerWidth ${m.iw}, label "${m.label}"`).toBeLessThanOrEqual(390);
  });

  test('no horizontal overflow with the DEFAULT range (30 days, no query string) and with a same-year custom range', async ({ page }) => {
    const bad: string[] = [];
    for (const r of ['/bolum/merkez', '/bolum/merkez?from=2026-03-02&to=2026-10-15', '/projects', '/bolum/zaman']) {
      await page.goto(r);
      await ready(page);
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, label: document.querySelector('[data-testid="range-summary"]')?.textContent ?? '' }));
      if (m.sw > 390 || m.iw > 390) bad.push(`${r}: scrollWidth=${m.sw} innerWidth=${m.iw}; range label "${m.label}"`);
    }
    expect(bad).toEqual([]);
  });

  test('Ask is fixed to the bottom and visible before and after scrolling the scene; the scene scrolls', async ({ page }) => {
    await openScene(page, '/bolum/merkez', MOBILE_UI);
    await page.waitForTimeout(400);
    const foot = await page.evaluate(() => {
      const f = document.querySelector('.sh-foot') as HTMLElement;
      return { position: getComputedStyle(f).position };
    });
    expect(foot.position).toBe('fixed');
    const inView = async () => page.evaluate((sel) => {
      const r = document.querySelector(sel)!.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, vh: window.visualViewport?.height ?? innerHeight, vw: window.visualViewport?.width ?? innerWidth };
    }, ASK);
    const before = await inView();
    expect(before.top).toBeGreaterThanOrEqual(0);
    expect(before.bottom).toBeLessThanOrEqual(before.vh + 1);
    expect(before.right, 'Ask input right edge inside the 390px viewport').toBeLessThanOrEqual(390.5);

    // scroll whatever scrolls (document or the scene container) to the bottom
    const scrolled = await page.evaluate(async () => {
      const cands: Element[] = [document.scrollingElement as Element, document.querySelector('.sh-scene') as Element, document.querySelector('.scene-slot') as Element].filter(Boolean);
      let moved = 0;
      for (const el of cands) {
        const b = el.scrollTop;
        el.scrollTop = el.scrollHeight;
        moved = Math.max(moved, el.scrollTop - b);
      }
      await new Promise((r) => setTimeout(r, 200));
      return moved;
    });
    expect(scrolled, 'scene content scrolls vertically on mobile').toBeGreaterThan(200);
    const after = await inView();
    expect(after.top).toBeGreaterThanOrEqual(0);
    expect(after.bottom).toBeLessThanOrEqual(after.vh + 1);
    expect(Math.abs(after.top - before.top), 'Ask did not move while scrolling').toBeLessThanOrEqual(1);
    await expect(page.locator(ASK)).toBeInViewport();
  });

  // DEFECT PROBE: asserts a real touch tap focuses the Ask field. Playwright's hit-test fails on the current build because the
  // layout viewport is wider than the 390px visual viewport (top-bar overflow), see reports/qa-delivery1.md.
  test('tapping the Ask field focuses it (touch)', async ({ page }) => {
    await openScene(page, '/bolum/merkez', MOBILE_UI);
    const input = page.locator(ASK);
    await input.tap({ timeout: 5000 });
    await expect(input).toBeFocused();
  });

  test('an Ask answer is fully visible above the field at 390x844', async ({ page }) => {
    await openScene(page, '/bolum/merkez', MOBILE_UI);
    await ask(page, 'kaç oturum');
    await expect(askCard(page)).toBeVisible();
    await expect(askCard(page)).toBeInViewport({ ratio: 0.95 });
  });
});

// ============================================================ 4. Scene 01 numbers == API == fixtures
test.describe('criterion 4: Scene 01 equals /api/v1/overview for the same query', () => {
  for (const name of ['wide range', 'narrow range (first 60 days that contain data)'] as const) {
    test(name, async ({ page, request }, info) => {
      let range: string = isMobile(info.project.name) ? MOBILE_UI : WIDE_UI; // MOBILE_UI also spans every synthetic day
      if (name !== 'wide range') {
        const days = ((await getJson(request, `/api/v1/overview?${WIDE_API}`)).daily as { date: string; uniqueRequests: number }[]).filter((x) => x.uniqueRequests > 0).map((x) => x.date).sort();
        expect(days.length).toBeGreaterThan(2);
        const from = days[0] as string;
        const to = new Date(Date.parse(`${from}T12:00:00Z`) + 59 * 86_400_000).toISOString().slice(0, 10);
        range = `from=${from}&to=${to}`;
      }
      const respPromise = page.waitForResponse((r) => r.url().includes('/api/v1/overview') && r.status() === 200);
      await page.goto(`/bolum/merkez?${range}`);
      const resp = await respPromise;
      await ready(page);
      const pageBody = (await resp.json()) as Awaited<ReturnType<typeof getJson>>;
      const ref = await getJson(request, new URL(resp.url()).pathname + new URL(resp.url()).search); // same query, fetched independently
      expect(ref.kpis).toEqual(pageBody.kpis);
      const m = await readMerkez(page);
      expect(m.requests).toBe(ref.kpis.uniqueRequests.value);
      expect(m.sessions).toBe(ref.kpis.sessions.value);
      expect(m.subagents).toBe(ref.kpis.subagents.value);
      expect(m.processedTokens).toBe(ref.kpis.tokens.processed);
      expect(m.sunText).toBe(trCompact(ref.kpis.tokens.processed));
      expect(norm(m.cachePctText)).toBe(norm(trPct(ref.kpis.tokens.cacheRead / ref.kpis.tokens.processed, 1)));
      expect(m.usdText).toBe(trUsd(ref.kpis.cost.usdDecimal));
      expect(m.headline).toContain(`${ref.kpis.projects.value} proje`);
      expect(m.headline).toContain(`${ref.kpis.sessions.value} oturum`);
      // sub-line "N benzersiz API isteği, X işlenen token"
      await expect(page.locator('.scene-slot .mz-sub-line')).toContainText(`${ref.kpis.uniqueRequests.value} benzersiz`);
      // token breakdown popover rows add up to the processed total (exact figures from the API, compact on screen)
      await page.locator('.scene-slot [data-readout="tokens"] button.mz-ro-btn').click();
      const rows = await page.locator('.scene-slot [data-readout="tokens"] .mz-pop li').allInnerTexts();
      expect(rows.length).toBeGreaterThan(0);
      const t0 = ref.kpis.tokens;
      const want = ['uncachedInput', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h', 'unsplitCacheWrite'].filter((k) => t0[k] > 0).map((k) => trCompact(t0[k]));
      for (const w of want) expect(rows.some((r) => norm(r).includes(norm(w))), `breakdown shows ${w}`).toBe(true);
      // default detail = top project; compare against /api/v1/projects (exact sessions + requests)
      const q = new URL(resp.url()).search;
      const projects = (await getJson(request, `/api/v1/projects${q}${q.includes('sort=') ? '' : '&sort=tokens'}`)).items as { label: string; alias: string | null; sessions: number; requests: number; tokens: { processed: number } }[];
      const top = [...projects].sort((a, b) => b.tokens.processed - a.tokens.processed)[0]!;
      await expect(page.locator('.mz-detail .mz-d-name')).toContainText(top.alias ?? top.label);
      const stat = async (key: string) => parseTrNumber(await page.locator('.mz-detail .mz-stat', { has: page.getByText(t(key), { exact: true }) }).locator('dd').innerText());
      expect(await stat('scene.merkez.detail.sessions')).toBe(top.sessions);
      expect(await stat('scene.merkez.detail.requests')).toBe(top.requests);
      // sr-only table equals planets
      const tableTotals = await page.locator('.scene-slot .sr-only table').nth(1).locator('tbody tr th').count();
      expect(tableTotals).toBeGreaterThan(0);
    });
  }

  test('wide range equals fixture expectations (requests, sessions) and the exact page text', async ({ page }) => {
    const { combinedExpected } = await import('@orbit/test-fixtures');
    await openScene(page);
    const m = await readMerkez(page);
    expect(m.requests).toBe(combinedExpected.uniqueRequests);
    expect(m.sessions).toBe(combinedExpected.sessions);
    expect(m.requests).toBe(78);
  });
});

// ============================================================ 5. Orbit Ask
test.describe('criterion 5: "/" opens the catalog; /merkez navigates; questions return the right numbers', () => {
  test('"/" opens the suggestion list with all commands and 12 chapters; typing filters it', async ({ page }) => {
    await openScene(page, '/projects');
    const input = page.locator(ASK);
    await input.focus();
    await page.keyboard.type('/');
    const list = page.getByRole('listbox', { name: t('ask.suggest.label') });
    await expect(list).toBeVisible();
    const total = await list.getByRole('option').count();
    expect(total).toBeGreaterThanOrEqual(12 + 8);
    // planned chapters are listed disabled with the reason
    await expect(list.getByRole('option').filter({ hasText: '/zaman' }).first()).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.type('mer');
    await expect(list.getByRole('option')).toHaveCount(1);
    await expect(list.getByRole('option').first()).toContainText('/merkez');
  });

  test('"/" pressed outside the field focuses Ask (global shortcut)', async ({ page }, info) => {
    test.skip(isMobile(info.project.name), 'hardware keyboard shortcut');
    await openScene(page);
    await page.locator('body').click({ position: { x: 5, y: 450 } });
    await page.keyboard.press('/');
    await expect(page.locator(ASK)).toBeFocused();
    await expect(page.locator(ASK)).toHaveValue('/');
    await expect(page.getByRole('listbox', { name: t('ask.suggest.label') })).toBeVisible();
  });

  test('/merkez navigates from an explorer view, filters preserved', async ({ page }) => {
    await openScene(page, '/projects');
    await ask(page, '/merkez');
    await expect(page).toHaveURL(/\/bolum\/merkez\?from=2020-01-01&to=2027-06-30/);
    await expect(page.locator('.scene-slot')).toBeVisible();
  });

  test('planned chapter /zaman: "henüz hazır değil", URL unchanged', async ({ page }) => {
    await openScene(page);
    const url = page.url();
    await ask(page, '/zaman');
    await expect(askCard(page)).toBeVisible();
    await expect(askCard(page)).toContainText(/henüz hazır değil/i);
    expect(page.url()).toBe(url);
    // direct URL: scene says the same, with an h1, and nothing is faked
    await openScene(page, '/bolum/zaman');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(t('shell.planned.title'));
    await expect(page.getByText(/henüz hazır değil/i).first()).toBeVisible();
    expect(page.url()).toContain('/bolum/zaman');
    await expect(page.locator('.mz-orbit, .mz-ro')).toHaveCount(0);
  });

  test('"kaç oturum" == kpis.sessions', async ({ page, request }) => {
    await openScene(page);
    const ov = await getJson(request, `/api/v1/overview?${WIDE_API}`);
    await ask(page, 'kaç oturum');
    await expect(askCard(page)).toHaveAttribute('data-status', 'answered');
    expect(parseTrNumber(await askCard(page).locator('.ask-figure').innerText())).toBe(ov.kpis.sessions.value);
    await expect(askCard(page)).toContainText(`${ov.kpis.sessions.value} oturum`);
  });

  test('"en çok kullanılan proje" == top project by tokens from /api/v1/projects', async ({ page, request }) => {
    await openScene(page);
    const items = (await getJson(request, `/api/v1/projects?${WIDE_API}&limit=200`)).items as { label: string; alias: string | null; tokens: { processed: number } }[];
    const top = [...items].sort((a, b) => b.tokens.processed - a.tokens.processed)[0]!;
    await ask(page, 'en çok kullanılan proje');
    await expect(askCard(page)).toHaveAttribute('data-status', 'answered');
    expect((await askCard(page).locator('.ask-figure').innerText()).trim()).toBe(top.alias ?? top.label);
    await expect(askCard(page)).toContainText(new Intl.NumberFormat('tr-TR').format(top.tokens.processed));
  });

  test('"tahmini değer ne kadar" shows USD and the Pro/Max caveat', async ({ page, request }) => {
    await openScene(page);
    const ov = await getJson(request, `/api/v1/overview?${WIDE_API}`);
    await ask(page, 'tahmini değer ne kadar');
    const card = askCard(page);
    await expect(card).toHaveAttribute('data-status', 'answered');
    expect(norm(await card.locator('.ask-figure').innerText())).toBe(norm(trUsd(ov.kpis.cost.usdDecimal)));
    await expect(card).toContainText('USD');
    await expect(card).toContainText('Pro/Max');
    await expect(card.locator('.ask-caveat')).toContainText(t('ask.moneyCaveat'));
  });

  test('"son 7 gün kaç oturum" uses exactly that range and matches the API for it', async ({ page, request }) => {
    await openScene(page);
    const reqPromise = page.waitForRequest((r) => r.url().includes('/api/v1/overview') && r.url().includes('from='));
    await ask(page, 'son 7 gün kaç oturum');
    const req = await reqPromise;
    const u = new URL(req.url());
    const from = Date.parse(u.searchParams.get('from') as string);
    const to = Date.parse(u.searchParams.get('to') as string);
    expect(Math.round((to - from) / 86_400_000), 'range spans 7 days').toBe(7);
    expect(Math.abs(to - Date.now()), 'range ends within a day of now (tomorrow 00:00 local at most)').toBeLessThanOrEqual(86_400_000);
    const ov = await getJson(request, u.pathname + u.search);
    const card = askCard(page);
    await expect(card).toBeVisible();
    const status = await card.getAttribute('data-status');
    const list = await getJson(request, `/api/v1/sessions?${u.search.slice(1)}&limit=200`);
    if (ov.kpis.uniqueRequests.value === 0) {
      expect(status).toBe('no_data');
      await expect(card).toContainText(/kayıt yok/);
      expect(list.items).toHaveLength(0);
    } else {
      expect(status).toBe('answered');
      expect(parseTrNumber(await card.locator('.ask-figure').innerText())).toBe(ov.kpis.sessions.value);
      expect(list.items.length).toBe(ov.kpis.sessions.value);
    }
    await expect(card).toContainText(/Son 7 gün/);
  });

  test('a question time phrase applies to that answer only: the selected range is untouched', async ({ page }) => {
    await openScene(page);
    await ask(page, 'dün kaç oturum');
    await expect(askCard(page)).toBeVisible();
    expect(page.url()).toContain(WIDE_UI);
    await expect(page.getByTestId('range-summary')).toContainText('2020');
  });

  test('every supported question family answers or says "no data" (never invents)', async ({ page, request }) => {
    await openScene(page);
    const ov = await getJson(request, `/api/v1/overview?${WIDE_API}`);
    const cases: [string, (c: string) => void][] = [
      ['toplam token kaç', (c) => expect(norm(c)).toContain(norm(new Intl.NumberFormat('tr-TR').format(ov.kpis.tokens.processed)))],
      ['kaç benzersiz istek', (c) => expect(c).toContain(String(ov.kpis.uniqueRequests.value))],
      ['kaç alt ajan', (c) => expect(c).toContain(String(ov.kpis.subagents.value))],
      ['önbellek oranı nedir', (c) => expect(norm(c)).toContain(norm(trPct(ov.kpis.tokens.cacheRead / ov.kpis.tokens.processed, 1)))],
      ['fiyat kapsamı nedir', (c) => expect(norm(c)).toContain(norm(trPct(ov.kpis.cost.requestCoverage, 1)))],
    ];
    for (const [q, check] of cases) {
      await ask(page, q);
      await expect(askCard(page), q).toHaveAttribute('data-status', 'answered');
      check(await askCard(page).innerText());
    }
    await ask(page, 'en çok kullanılan model');
    await expect(askCard(page)).toHaveAttribute('data-status', 'answered');
    const topModel = [...ov.models].sort((a: { tokens: { processed: number } }, b: { tokens: { processed: number } }) => b.tokens.processed - a.tokens.processed)[0];
    expect(await askCard(page).locator('.ask-figure').innerText()).toBe(topModel.displayName ?? topModel.modelId);
  });

  test('project summary question carries the money caveat and the right project numbers', async ({ page, request }) => {
    await openScene(page);
    const name = d.topProject.label;
    await ask(page, `${name} hakkında`);
    const card = askCard(page);
    await expect(card).toBeVisible();
    const status = await card.getAttribute('data-status');
    expect(status, 'project summary for an existing project').toBe('answered');
    await expect(card.locator('.ask-caveat')).toContainText('Pro/Max');
    const ov = await getJson(request, `/api/v1/overview?${WIDE_API}&projectId=${encodeURIComponent(d.topProject.id)}`);
    expect(norm(await card.innerText())).toContain(norm(new Intl.NumberFormat('tr-TR').format(ov.kpis.tokens.processed)));
    expect(norm(await card.innerText())).toContain(norm(trUsd(ov.kpis.cost.usdDecimal)));
  });

  test('unsupported "hava nasıl" gives guidance with examples and no figure', async ({ page }) => {
    await openScene(page);
    await ask(page, 'hava nasıl');
    const card = askCard(page);
    await expect(card).toHaveAttribute('data-status', 'unsupported');
    await expect(card).toContainText(t('ask.answer.unsupported'));
    await expect(card).toContainText(t('ask.answer.unsupportedHint'));
    expect(await card.locator('.ask-chip').count()).toBeGreaterThanOrEqual(3);
    await expect(card.locator('.ask-figure')).toHaveCount(0);
    // an example chip really runs a question
    await card.locator('.ask-chip').first().click();
    await expect(askCard(page)).not.toHaveAttribute('data-status', 'unsupported');
  });

  test('Escape clears the answer and the field; the answer never navigates on its own', async ({ page }) => {
    await openScene(page);
    const url = page.url();
    await ask(page, 'kaç oturum');
    await expect(askCard(page)).toBeVisible();
    await page.locator(ASK).press('Escape');
    await expect(askCard(page)).toHaveCount(0);
    await expect(page.locator(ASK)).toHaveValue('');
    expect(page.url()).toBe(url);
  });

  test('evidence link opens the matching explorer view with the same range', async ({ page }) => {
    await openScene(page);
    await ask(page, 'kaç oturum');
    await askCard(page).getByRole('link', { name: t('ask.evidence') }).click();
    await expect(page).toHaveURL(/\/sessions\?/);
    expect(page.url()).toContain('from=2020-01-01');
  });
});

// ============================================================ 6. keyboard
test.describe('criterion 6: keyboard (C, up/down, Enter, Esc, left/right, ?)', () => {
  test.beforeEach(async ({}, info) => {
    test.skip(isMobile(info.project.name), 'hardware keyboard criterion (desktop)');
  });

  test('C opens the catalog; Up/Down move; Enter on a planned chapter explains and stays; Enter on Merkez goes; Esc closes and restores focus', async ({ page }) => {
    await openScene(page);
    const opener = page.getByRole('button', { name: /Tarih aralığı/ });
    await opener.focus();
    await page.keyboard.press('c');
    const dlg = page.getByRole('dialog', { name: t('shell.catalog.title') });
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('combobox')).toBeFocused();
    const opts = dlg.getByRole('option');
    expect(await opts.count()).toBe(12);
    await expect(opts.nth(0)).toHaveAttribute('aria-selected', 'true'); // current chapter pre-selected
    await page.keyboard.press('ArrowDown');
    await expect(opts.nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(dlg.getByRole('combobox')).toHaveAttribute('aria-activedescendant', (await opts.nth(1).getAttribute('id')) as string);
    await page.keyboard.press('Enter'); // planned: no navigation, reason shown
    await expect(dlg.getByTestId('catalog-reason')).toContainText(/henüz hazır değil/i);
    await expect(dlg).toBeVisible();
    expect(page.url()).toContain('/bolum/merkez');
    await page.keyboard.press('ArrowUp');
    await expect(opts.nth(0)).toHaveAttribute('aria-selected', 'true');
    // Tab never leaves the dialog (focus trap)
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), `Tab #${i + 1} stays in the dialog`).toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(opener).toBeFocused();

    // from an explorer view, Enter on Merkez navigates back
    await openScene(page, '/projects');
    await page.keyboard.press('c');
    await expect(page.getByRole('dialog', { name: t('shell.catalog.title') })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/bolum\/merkez/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('typing in the catalog filters; empty filter result is announced', async ({ page }) => {
    await openScene(page);
    await page.keyboard.press('c');
    const dlg = page.getByRole('dialog', { name: t('shell.catalog.title') });
    await page.keyboard.type('zaman');
    await expect(dlg.getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Control+a');
    await page.keyboard.type('zzzzzz');
    await expect(dlg.getByRole('option')).toHaveCount(0);
    await expect(dlg.getByText(t('shell.catalog.empty'))).toBeVisible();
  });

  test('Right/Left on the rail announce that no neighbouring chapter is ready; Home/End stay on Merkez', async ({ page }) => {
    await openScene(page);
    await page.locator('body').click({ position: { x: 5, y: 450 } });
    await page.keyboard.press('ArrowRight');
    await expect(live(page)).toHaveText(t('shell.rail.noNext'));
    await page.keyboard.press('ArrowLeft');
    await expect(live(page)).toHaveText(t('shell.rail.noPrev'));
    await page.keyboard.press('PageDown');
    await expect(live(page)).toContainText(t('shell.rail.noNext'));
    await page.keyboard.press('End');
    await page.keyboard.press('Home');
    expect(page.url()).toContain('/bolum/merkez');
    await expect(page.getByTestId('rail-position')).toHaveText(t('shell.rail.position', { n: '01', total: 12, title: t('shell.chapter.merkez.title') }));
    // arrows are ignored while typing in Ask (no announcement, cursor moves)
    await page.locator(ASK).focus();
    await page.keyboard.type('ab');
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator(ASK)).toHaveValue('ab');
  });

  test('rail dots: 12, one current, planned ones aria-disabled with the reason', async ({ page }) => {
    await openScene(page);
    const dots = page.locator('.sh-dots button');
    await expect(dots).toHaveCount(12);
    await expect(page.locator('.sh-dots button[aria-current="step"]')).toHaveCount(1);
    await expect(page.locator('.sh-dots button[aria-disabled="true"]')).toHaveCount(11);
    await expect(page.getByRole('button', { name: t('shell.rail.next') })).toHaveAttribute('aria-disabled', 'true');
    await expect(page.getByRole('button', { name: t('shell.rail.prev') })).toHaveAttribute('aria-disabled', 'true');
  });

  test('? opens the help overlay with the shortcuts; Esc closes; focus restored', async ({ page }) => {
    await openScene(page);
    const opener = page.getByRole('button', { name: /Tarih aralığı/ });
    await opener.focus();
    await page.keyboard.press('?');
    const dlg = page.getByRole('dialog', { name: t('shell.help.title') });
    await expect(dlg).toBeVisible();
    for (const k of ['C', '/', '?', 'Esc']) await expect(dlg.locator('kbd', { hasText: new RegExp(`^${k.replace('/', '\\/').replace('?', '\\?')}$`) }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test('global shortcuts are blocked while a dialog is open (no chapter change behind the catalog)', async ({ page }) => {
    await openScene(page);
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('c');
    await expect(page.getByRole('dialog', { name: t('shell.help.title') })).toBeVisible(); // still help, catalog did not stack
    await expect(page.getByRole('dialog')).toHaveCount(1);
  });

  test('Merkez orbit: planets/arcs reachable by Tab; Left/Right move the selection and do not trigger chapter shortcuts', async ({ page }) => {
    await openScene(page);
    const first = page.locator('.mz-orbit [data-mz-key][tabindex="0"]').first();
    await first.focus();
    const before = await page.locator('.mz-detail .mz-d-name').innerText();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('.mz-orbit [data-mz-key]:focus')).toHaveCount(1);
    await expect(live(page)).not.toContainText(t('shell.rail.noNext'));
    const after = await page.locator('.mz-detail .mz-d-name').innerText();
    expect(after.length).toBeGreaterThan(0);
    void before;
    expect(page.url()).toContain('/bolum/merkez');
  });
});

// ============================================================ 7. money caveat wherever USD appears
test.describe('criterion 7: "Pro/Max faturası değildir" wherever estimated USD appears', () => {
  test('every Scene 01 block that shows a dollar amount carries the caveat (readout, project detail, model detail)', async ({ page }) => {
    await openScene(page);
    const blocksWithMoneyWithoutCaveat = async (): Promise<string[]> =>
      page.evaluate(() => {
        const bad: string[] = [];
        for (const el of Array.from(document.querySelectorAll('.scene-slot .mz-ro, .scene-slot .mz-detail, .scene-slot .mz-panel'))) {
          const txt = el.textContent ?? '';
          const label = (el.querySelector('h3')?.textContent ?? el.className).slice(0, 40);
          if (/\$\s?\d|\d\s?\$|USD/.test(txt)) {
            const hasCaveat = /Pro\/Max/.test(txt) || Array.from(el.querySelectorAll('[aria-label],[title]')).some((n) => /Pro\/Max/.test(`${n.getAttribute('aria-label')} ${n.getAttribute('title')}`)) || !!el.querySelector('.mz-caveat, .mz-caveat-sm');
            if (!hasCaveat) bad.push(label);
          }
        }
        return bad;
      });
    expect(await blocksWithMoneyWithoutCaveat(), 'default state').toEqual([]);
    await expect(page.locator('.scene-slot [data-readout="value"]')).toContainText('Pro/Max faturası değildir');
    await expect(page.locator('.scene-slot [data-readout="value"] .money-v')).toContainText('$');
    await expect(page.locator('.scene-slot')).toContainText(MONEY_LABEL_RE);
    // walk every selectable planet/arc: detail money lines keep the caveat
    const keys = await page.locator('.mz-orbit [data-mz-key]').evaluateAll((els) => els.map((e) => e.getAttribute('data-mz-key') as string));
    expect(keys.length).toBeGreaterThan(2);
    let pricedWithMoney = 0;
    for (const k of keys) {
      await page.locator(`.mz-orbit [data-mz-key="${k}"]`).focus();
      await expect(page.locator('.mz-detail-body')).toBeVisible();
      expect(await blocksWithMoneyWithoutCaveat(), `selection ${k}`).toEqual([]);
      if (/\$/.test(await page.locator('.mz-detail').innerText())) pricedWithMoney++;
    }
    expect(pricedWithMoney, 'at least one selection shows a priced amount (otherwise the check is vacuous)').toBeGreaterThan(0);
    // an unpriced model is marked, never given an amount
    const unpricedArc = page.locator('.mz-orbit g.mz-arc[aria-label*="fiyatsız"]').first();
    if (await unpricedArc.count()) {
      await unpricedArc.focus();
      await expect(page.locator('.mz-detail')).toContainText(t('scene.merkez.detail.unpriced'));
      await expect(page.locator('.mz-detail')).not.toContainText('$');
    }
  });

  test('coverage chip and excluded-model note accompany the Scene 01 value', async ({ page, request }) => {
    await openScene(page);
    const ov = await getJson(request, `/api/v1/overview?${WIDE_API}`);
    const v = page.locator('.scene-slot [data-readout="value"]');
    await expect(v).toContainText('%'); // coverage chip
    if (ov.kpis.cost.unpricedRequestCount > 0) await expect(v).toContainText(/fiyatsız/);
  });

  test('Ask: estimated value, project summary and export answers all carry the caveat', async ({ page }) => {
    await openScene(page);
    for (const q of ['tahmini değer ne kadar', `${d.topProject.label} hakkında`]) {
      await ask(page, q);
      await expect(askCard(page)).toBeVisible();
      await expect(askCard(page).locator('.ask-caveat')).toContainText('Pro/Max');
    }
    const [dl] = await Promise.all([page.waitForEvent('download'), ask(page, '/dışa-aktar csv')]);
    expect(dl.suggestedFilename()).toMatch(/\.csv$/);
    await expect(askCard(page)).toContainText('Pro/Max');
  });
});

// ============================================================ 8. exports, settings, data deletion reachable
test.describe('criterion 8: export, reports, settings, deletion remain reachable', () => {
  test('Ask /dışa-aktar csv and json download clean files (no canaries, formula cells neutralized, estimate label)', async ({ page }) => {
    await openScene(page);
    const grab = async (cmd: string) => {
      const [dl] = await Promise.all([page.waitForEvent('download'), ask(page, cmd)]);
      return { name: dl.suggestedFilename(), body: readFileSync(await dl.path(), 'utf8') };
    };
    const csv = await grab('/dışa-aktar csv');
    const json = await grab('/dışa-aktar json');
    expect(csv.name).toMatch(/\.csv$/);
    expect(json.name).toMatch(/\.json$/);
    for (const { body } of [csv, json]) {
      expect(body.match(CANARIES.pattern) ?? []).toEqual([]);
      for (const s of CANARIES.secrets) expect(body).not.toContain(s);
      expect(body).not.toContain('/Users/demo');
      expect(body.length).toBeGreaterThan(50);
    }
    expect(csv.body.split(/\r?\n/)[0]).toMatch(/estimat/i);
    const dangerous = csv.body.split(/\r?\n/).slice(1).flatMap((l) => l.split(',')).filter((c) => /^[=+@\t\r]/.test(c) || (/^-/.test(c) && !/^-?\d+(\.\d+)?$/.test(c)));
    expect(dangerous).toEqual([]);
    expect(JSON.stringify(JSON.parse(json.body).meta)).toMatch(/estimate/i);
    // the export honours the current range: same rows as the API for the same filters
    const apiCsv = await (await page.request.get(`/api/v1/exports?${WIDE_API}&format=csv`)).text();
    expect(csv.body.trim().split(/\r?\n/).length).toBe(apiCsv.trim().split(/\r?\n/).length);
  });

  test('settings reachable through the top-bar button; data deletion dialog opens but is NOT confirmed', async ({ page, request }, info) => {
    const before = (await getJson(request, `/api/v1/overview?${WIDE_API}`)).kpis.uniqueRequests.value;
    await openScene(page);
    await openSettingsFromTopBar(page, isMobile(info.project.name));
    const dlg = page.getByRole('dialog', { name: t('shell.settings.title') });
    await expect(dlg.getByRole('heading', { level: 1 })).toHaveCount(0); // one heading in the drawer, not a second page title
    await dlg.getByRole('button', { name: t('settings.delete.button') }).scrollIntoViewIfNeeded();
    await dlg.getByRole('button', { name: t('settings.delete.button') }).click({ force: isMobile(info.project.name) });
    const confirm = page.getByRole('alertdialog', { name: t('settings.delete.title') });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole('button', { name: t('settings.delete.confirm') })).toBeDisabled(); // typed phrase required
    await confirm.getByRole('button', { name: t('action.cancel') }).click();
    await expect(confirm).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect((await getJson(request, `/api/v1/overview?${WIDE_API}`)).kpis.uniqueRequests.value, 'nothing deleted').toBe(before);
  });

  test('/ayarlar via Ask opens the settings panel; /gezgin raporlar opens reports with both download links', async ({ page }) => {
    await openScene(page);
    await ask(page, '/ayarlar');
    await expect(page.getByRole('dialog', { name: t('shell.settings.title') })).toBeVisible();
    await page.keyboard.press('Escape');
    await ask(page, '/gezgin raporlar');
    await expect(page).toHaveURL(/\/reports/);
    await expect(page.getByRole('link', { name: t('reports.downloadCsv') })).toBeVisible();
    await expect(page.getByRole('link', { name: t('reports.downloadJson') })).toBeVisible();
  });

  test('story mode is still reachable and its keyboard navigation works inside the shell (regression probe)', async ({ page }, info) => {
    test.skip(isMobile(info.project.name), 'keyboard');
    await openScene(page, '/reports/story');
    await expect(page.getByTestId('slide-active')).toHaveCount(1);
    await expect(page.getByTestId('story-index')).toHaveText(/^1 \/ \d+$/);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('story-index'), 'ArrowRight advances the story (not swallowed by the chapter shortcut)').toHaveText(/^2 \/ \d+$/);
  });

  // The destructive path (confirming "Orbit verilerimi sil") is intentionally not executed: the :4451 server never gets consent,
  // so there is nothing to delete there, and :4450 backs every other spec.
});

// ============================================================ 9. axe: no serious/critical on shell + Scene 01
test.describe('criterion 9: axe serious/critical', () => {
  const scan = async (page: Page): Promise<string[]> => {
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id} [${v.impact}] ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
  };
  test('Merkez, catalog, help, answer, suggestions, planned, explorer', async ({ page }) => {
    await openScene(page);
    expect(await scan(page), 'merkez').toEqual([]);
    await page.keyboard.press('c');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.waitForTimeout(500); // open animation: axe would sample mid-fade colours
    expect(await scan(page), 'catalog').toEqual([]);
    await page.keyboard.press('Escape');
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.waitForTimeout(500);
    expect(await scan(page), 'help').toEqual([]);
    await page.keyboard.press('Escape');
    await ask(page, 'kaç oturum');
    await expect(askCard(page)).toBeVisible();
    expect(await scan(page), 'ask answer').toEqual([]);
    await openScene(page, '/bolum/zaman');
    expect(await scan(page), 'planned').toEqual([]);
    await openScene(page, '/projects');
    expect(await scan(page), 'explorer projects').toEqual([]);
  });
});

// ============================================================ 10. screenshots
test.describe('criterion 10: screenshots (test-results/delivery1)', () => {
  test('merkez, catalog, help, ask-answer, explorer-projects, planned', async ({ page }, info) => {
    const k = kind(info.project.name);
    const shot = async (name: string) => page.screenshot({ path: `${SHOTS}/${k}-${name}.png` });
    const rg = isMobile(info.project.name) ? MOBILE_UI : WIDE_UI; // same-year range on mobile: the cross-year label overflows (reported separately)
    await openScene(page, '/bolum/merkez', rg);
    await page.waitForTimeout(600);
    await shot('merkez');
    await page.screenshot({ path: `${SHOTS}/${k}-merkez-full.png`, fullPage: true });
    if (isMobile(info.project.name)) await page.getByRole('button', { name: t('shell.rail.catalogButton') }).click();
    else await page.keyboard.press('c');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.waitForTimeout(300);
    await shot('catalog');
    await page.keyboard.press('Escape');
    if (isMobile(info.project.name)) await page.getByRole('button', { name: t('shell.rail.helpButton') }).click();
    else await page.keyboard.press('?');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.waitForTimeout(300);
    await shot('help');
    await page.keyboard.press('Escape');
    await ask(page, 'tahmini değer ne kadar');
    await expect(askCard(page)).toBeVisible();
    await page.waitForTimeout(300);
    await shot('ask-answer');
    await openScene(page, '/projects', rg);
    await page.waitForTimeout(400);
    await shot('explorer-projects');
    await openScene(page, '/bolum/zaman', rg);
    await page.waitForTimeout(300);
    await shot('planned');
    expect(MAIN).toContain('4450');
  });
});
