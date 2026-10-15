import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { CORE_ROUTES, FRESH, MOBILE_UI, PHASE4_ROUTES, WIDE_UI, discover, findPhase4Path, ready, type Discovered } from './support/index.js';

// The cross-year range label ("1 Oca 2020 – 30 Haz 2027") overflows the 390px top bar; that single defect is asserted in delivery1.spec.ts.
// Here mobile uses a same-year range so every OTHER source of horizontal overflow is still detected.
const rng = (path: string, project: string): string => (project === 'mobile' ? path.replace(WIDE_UI, MOBILE_UI) : path);

const SHOTS = 'test-results/screens';

async function overflow(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const de = document.documentElement;
    if (de.scrollWidth <= de.clientWidth) return '';
    const offenders: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      // position:fixed layers (starfield) never extend the scrollable area; tables inside a scroll container are not page overflow
      let skip = false;
      for (let e: Element | null = el; e && e !== document.body; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.position === 'fixed' || (e !== el && /(auto|scroll|hidden)/.test(cs.overflowX) && e.getBoundingClientRect().right <= de.clientWidth + 1)) { skip = true; break; }
      }
      if (!skip && r.right > de.clientWidth + 1 && r.width > 0) offenders.push(`${el.tagName.toLowerCase()}.${String(el.getAttribute('class') ?? '').split(' ')[0]} right=${Math.round(r.right)}`);
      if (offenders.length >= 4) break;
    }
    return `scrollWidth=${de.scrollWidth} clientWidth=${de.clientWidth}; first offenders: ${offenders.join(', ')}`;
  });
}

test.describe('no horizontal page overflow + screenshots', () => {
  let d: Discovered;
  test.beforeAll(async ({ request }) => {
    d = await discover(request);
    mkdirSync(SHOTS, { recursive: true });
  });

  test('onboarding (fresh server)', async ({ page }, info) => {
    await page.goto(`${FRESH}/`);
    await ready(page);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-onboarding.png`, fullPage: true });
    expect(await overflow(page)).toBe('');
  });

  for (const r of CORE_ROUTES) {
    test(r.name, async ({ page }, info) => {
      await page.goto(rng(r.path(d), info.project.name));
      await ready(page);
      if (r.after) await r.after(page);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/${info.project.name}-${r.name}.png`, fullPage: true });
      expect(await overflow(page)).toBe('');
    });
  }

  for (const r of PHASE4_ROUTES) {
    test(`${r.name} (phase 4)`, async ({ page }, info) => {
      const p = await findPhase4Path(page, r.candidates);
      test.skip(!p, `route ${r.candidates.join(' | ')} not present yet`);
      await page.goto(rng(p as string, info.project.name));
      await ready(page);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/${info.project.name}-${r.name}.png`, fullPage: true });
      expect(await overflow(page)).toBe('');
    });
  }
});

// ---------------------------------------------------------------- Scene 01 must fit without page scroll on desktop (EXPERIENCE.md §1, §6.2)
const FIT_VIEWPORTS = [
  { w: 1440, h: 900 },
  { w: 1366, h: 768 },
  { w: 1280, h: 800 },
];
for (const vp of FIT_VIEWPORTS) {
  test.describe(`Scene 01 fits ${vp.w}x${vp.h}`, () => {
    test.use({ viewport: { width: vp.w, height: vp.h } });
    test(`/bolum/merkez: document and .scene-slot do not scroll`, async ({ page }, info) => {
      test.skip(info.project.name === 'mobile', 'desktop-only criterion');
      await page.goto(`/bolum/merkez?from=2020-01-01&to=2027-06-30`);
      await ready(page);
      await page.waitForTimeout(500);
      const m = await page.evaluate(() => {
        const slot = document.querySelector('.scene-slot') as HTMLElement | null;
        const clipped: string[] = [];
        // anything inside the scene whose box falls outside the scene slot is cut off by overflow (or forces scroll)
        if (slot) {
          const sr = slot.getBoundingClientRect();
          for (const el of Array.from(slot.querySelectorAll('*'))) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0 || el.closest('svg') || el.closest('.sr-only')) continue;
            if (r.bottom > sr.bottom + 1 || r.right > sr.right + 1) clipped.push(`${el.tagName.toLowerCase()}.${String(el.getAttribute('class') ?? '').split(' ')[0]} bottom=${Math.round(r.bottom - sr.bottom)} right=${Math.round(r.right - sr.right)}`);
            if (clipped.length >= 6) break;
          }
        }
        return {
          docScrollH: document.documentElement.scrollHeight,
          innerH: window.innerHeight,
          slotScrollH: slot?.scrollHeight ?? -1,
          slotClientH: slot?.clientHeight ?? -1,
          clipped,
        };
      });
      mkdirSync('test-results/delivery1', { recursive: true });
      await page.screenshot({ path: `test-results/delivery1/desktop-merkez-${vp.w}x${vp.h}.png` });
      expect(m.docScrollH, `document scrollHeight ${m.docScrollH} vs innerHeight ${m.innerH}`).toBeLessThanOrEqual(m.innerH);
      expect(m.slotScrollH, `.scene-slot scrollHeight ${m.slotScrollH} vs clientHeight ${m.slotClientH}; clipped: ${m.clipped.join(' | ')}`).toBeLessThanOrEqual(m.slotClientH);
      expect(m.clipped, 'scene content boxes outside the scene slot').toEqual([]);
    });
  });
}
