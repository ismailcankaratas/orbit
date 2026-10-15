import { AxeBuilder } from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { CORE_ROUTES, FRESH, PHASE4_ROUTES, WIDE_UI, ask, askCard, discover, findPhase4Path, openScene, ready, t, tRe, type Discovered } from './support/index.js';

async function scan(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return r.violations.map((v) => `${v.id} [${v.impact}] x${v.nodes.length}: ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

test.describe('axe wcag2a + wcag2aa', () => {
  let d: Discovered;
  test.beforeAll(async ({ request }) => {
    d = await discover(request);
  });

  test('onboarding (fresh, unconsented server)', async ({ page }) => {
    await page.goto(`${FRESH}/`);
    await ready(page);
    expect(await scan(page)).toEqual([]);
  });

  for (const r of CORE_ROUTES) {
    test(r.name, async ({ page }) => {
      await page.goto(r.path(d));
      await ready(page);
      if (r.after) await r.after(page);
      await page.waitForTimeout(300);
      expect(await scan(page)).toEqual([]);
    });
  }

  test('catalog modal open', async ({ page }) => {
    await openScene(page);
    await page.keyboard.press('c');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.waitForTimeout(300);
    expect(await scan(page)).toEqual([]);
  });

  test('help overlay open', async ({ page }) => {
    await openScene(page);
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.waitForTimeout(300);
    expect(await scan(page)).toEqual([]);
  });

  test('Orbit Ask: answer card open, and suggestion list open', async ({ page }) => {
    await openScene(page);
    await ask(page, 'tahmini değer ne kadar');
    await expect(askCard(page)).toBeVisible();
    await page.waitForTimeout(300);
    expect(await scan(page), 'answer card').toEqual([]);
    await page.keyboard.press('Escape');
    await page.locator('[data-orbit-ask-input]').fill('/');
    await expect(page.getByRole('listbox')).toBeVisible();
    await page.waitForTimeout(300);
    expect(await scan(page), 'suggestion list').toEqual([]);
  });

  test('settings drawer open', async ({ page }, info) => {
    await openScene(page);
    if (info.project.name === 'mobile') await page.getByRole('button', { name: t('shell.menu.open') }).click();
    await page.getByRole('button', { name: t('shell.settings.open'), exact: true }).last().click(); // mobile: the menu popover trigger and its item share the name
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.waitForTimeout(400);
    expect(await scan(page)).toEqual([]);
  });

  test('top-bar date popover open', async ({ page }) => {
    await openScene(page);
    await page.getByRole('button', { name: /Tarih aralığı/ }).click();
    await expect(page.getByRole('group', { name: t('filter.presets') })).toBeVisible();
    await page.waitForTimeout(300);
    expect(await scan(page)).toEqual([]);
  });

  test('agent drawer open', async ({ page }) => {
    await page.goto(`/agents?${WIDE_UI}`);
    await ready(page);
    await page.getByRole('button', { name: t('agents.view.list') }).click();
    await page.getByRole('button', { name: tRe('agent.inspect') }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.waitForTimeout(300);
    expect(await scan(page)).toEqual([]);
  });

  for (const r of PHASE4_ROUTES) {
    test(`${r.name} (phase 4)`, async ({ page }) => {
      const p = await findPhase4Path(page, r.candidates);
      test.skip(!p, `route ${r.candidates.join(' | ')} not present yet`);
      await page.goto(p as string);
      await ready(page);
      await page.waitForTimeout(300);
      expect(await scan(page)).toEqual([]);
    });
  }
});

test.describe('keyboard', () => {
  test('first Tab reaches the skip link and activating it moves focus into main', async ({ page }) => {
    await page.goto(`/bolum/merkez?${WIDE_UI}`);
    await ready(page);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: t('a11y.skip') });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport(); // visible once focused
    await page.keyboard.press('Enter');
    const inMain = await page.evaluate(() => {
      const m = document.getElementById('main');
      return !!m && (document.activeElement === m || m.contains(document.activeElement));
    });
    expect(inMain, 'focus is inside #main after skip link').toBe(true);
  });

  test('onboarding: skip link first as well', async ({ page }) => {
    await page.goto(`${FRESH}/`);
    await ready(page);
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: t('a11y.skip') })).toBeFocused();
  });

  for (const path of [`/bolum/merkez?${WIDE_UI}`, `/projects?${WIDE_UI}`, '/settings']) {
    test(`every focused element has a visible focus indicator: ${path.split('?')[0]}`, async ({ page }) => {
      await page.goto(path);
      await ready(page);
      const missing: string[] = [];
      let seen = 0;
      for (let i = 0; i < 45; i++) {
        await page.keyboard.press('Tab');
        const info = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement | null;
          if (!el || el === document.body) return null;
          const cs = getComputedStyle(el);
          const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
          const shadow = cs.boxShadow !== 'none';
          // SVG graph nodes draw their focus ring as a child element
          const ring = el.querySelector('.node-ring');
          const ringOk = ring ? parseFloat(getComputedStyle(ring).strokeWidth) >= 3 : false;
          const rect = el.getBoundingClientRect();
          // Orbit Ask draws its ring on the wrapping form (:focus-within) and removes the input's own outline
          const host = el.closest('.ask-form');
          const hostCs = host ? getComputedStyle(host) : null;
          const hostOk = !!hostCs && host!.matches(':focus-within') && ((hostCs.outlineStyle !== 'none' && parseFloat(hostCs.outlineWidth) > 0) || hostCs.boxShadow !== 'none');
          // Chromium date inputs: one tab stop is the native picker button, which draws its own native ring (host is not :focus-visible)
          if (el instanceof HTMLInputElement && el.type === 'date' && !el.matches(':focus-visible')) return { ok: true, visible: true, desc: '', label: '' };
          return { ok: outline || shadow || ringOk || hostOk, visible: rect.width > 0 && rect.height > 0, desc: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.getAttribute('class') ?? '').split(' ')[0]}`, label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30) };
        });
        if (!info) continue;
        seen++;
        if (info.visible && !info.ok) missing.push(`${info.desc} "${info.label}"`);
      }
      expect(seen, 'tab stops visited').toBeGreaterThan(5);
      expect(missing).toEqual([]);
    });
  }
});

test.describe('prefers-reduced-motion', () => {
  async function running(page: Page): Promise<string[]> {
    return page.evaluate(() =>
      document.getAnimations().filter((a) => a.playState === 'running').map((a) => {
        const e = a.effect as KeyframeEffect | null;
        const tgt = e?.target as Element | null;
        return `${(a as CSSAnimation).animationName ?? (a as CSSTransition).transitionProperty ?? 'anim'} on ${tgt?.tagName.toLowerCase() ?? '?'}.${String(tgt?.getAttribute('class') ?? '').split(' ')[0]} dur=${e?.getTiming().duration} iter=${e?.getTiming().iterations}`;
      }),
    );
  }

  test('merkez: no running animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/bolum/merkez?${WIDE_UI}`);
    await ready(page);
    await page.waitForTimeout(1000);
    expect(await running(page)).toEqual([]);
  });

  test('story: no running animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const p = await findPhase4Path(page, PHASE4_ROUTES.find((r) => r.name === 'story')!.candidates);
    test.skip(!p, 'story route not present yet');
    await page.goto(p as string);
    await ready(page);
    await page.waitForTimeout(1000);
    expect(await running(page)).toEqual([]);
  });
});

