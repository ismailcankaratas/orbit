import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { CORE_ROUTES, FRESH, PHASE4_ROUTES, discover, findPhase4Path, ready, type Discovered } from './support/index.js';

const SHOTS = 'test-results/screens';

async function overflow(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const de = document.documentElement;
    if (de.scrollWidth <= de.clientWidth) return '';
    const offenders: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll('*'))) {
      const r = el.getBoundingClientRect();
      if (r.right > de.clientWidth + 1 && r.width > 0) offenders.push(`${el.tagName.toLowerCase()}.${String(el.getAttribute('class') ?? '').split(' ')[0]} right=${Math.round(r.right)}`);
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
      await page.goto(r.path(d));
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
      await page.goto(p as string);
      await ready(page);
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${SHOTS}/${info.project.name}-${r.name}.png`, fullPage: true });
      expect(await overflow(page)).toBe('');
    });
  }
});
