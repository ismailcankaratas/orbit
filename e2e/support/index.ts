import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const MAIN = 'http://127.0.0.1:4450';
export const FRESH = 'http://127.0.0.1:4451';
export const sourceRoot = (): string => join(process.env.ORBIT_E2E_ROOT as string, 'source');

// ---------------------------------------------------------------- i18n (Turkish strings are the single source of truth)
const tr = JSON.parse(readFileSync(new URL('../../apps/web/src/i18n/locales/tr.json', import.meta.url), 'utf8')) as Record<string, string>;
export const hasKey = (key: string): boolean => key in tr || `${key}.other` in tr;
export function t(key: string, params: Record<string, string | number> = {}): string {
  let k = key;
  if ('count' in params && `${key}.other` in tr) k = Number(params.count) === 1 && `${key}.one` in tr ? `${key}.one` : `${key}.other`;
  const s = tr[k];
  if (s === undefined) throw new Error(`missing tr.json key: ${key}`);
  return s.replace(/\{(\w+)\}/g, (_m, p: string) => String(params[p] ?? `{${p}}`));
}
/** Regex matching a templated string, e.g. tRe('agent.inspect'). Unspecified placeholders match anything. */
export function tRe(key: string, params: Record<string, string> = {}): RegExp {
  const raw = (tr[key] ?? tr[`${key}.other`]) as string;
  const esc = raw.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, (_m, p: string) => params[p] ?? '.*');
  return new RegExp(esc);
}
/** Parses the tr-TR number format used by the UI ("1.234", "12,5"). */
export function parseTrNumber(text: string): number {
  const m = text.replace(/\s/g, ' ').match(/-?[\d.]+(?:,\d+)?/);
  if (!m) throw new Error(`no number in "${text}"`);
  return Number(m[0].replace(/\./g, '').replace(',', '.'));
}

// ---------------------------------------------------------------- ranges (synthetic scenarios span 2026-03 .. 2026-11)
export const WIDE_UI = 'from=2020-01-01&to=2027-06-30';
export const WIDE_API = 'from=2020-01-01T00:00:00Z&to=2027-06-30T00:00:00Z';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getJson<T = any>(request: APIRequestContext, path: string): Promise<T> {
  const res = await request.get(path);
  expect(res.status(), `GET ${path}`).toBe(200);
  return (await res.json()) as T;
}

export interface Discovered {
  topProject: { id: string; label: string };
  htmlProject: { id: string; label: string } | undefined;
  sessionWithAgent: { id: string; projectId: string } | undefined;
  anySession: { id: string } | undefined;
}

export async function discover(request: APIRequestContext): Promise<Discovered> {
  const ov = await getJson(request, `/api/v1/overview?${WIDE_API}`);
  const projects = (await getJson(request, `/api/v1/projects?${WIDE_API}`)).items as { id: string; label: string; alias: string | null }[];
  const sessions = (await getJson(request, `/api/v1/sessions?${WIDE_API}&limit=200`)).items as { id: string; projectId: string; subagentCount: number }[];
  const top = ov.topProjects[0] ?? projects[0];
  return {
    topProject: { id: top.id, label: top.alias ?? top.label },
    htmlProject: projects.find((p) => p.label.includes('<img')),
    sessionWithAgent: sessions.find((s) => s.subagentCount > 0),
    anySession: sessions[0],
  };
}

// ---------------------------------------------------------------- routes
export interface RouteDef {
  name: string;
  path: (d: Discovered) => string;
  /** extra UI step after load (e.g. switch the agents view to the list) */
  after?: (page: Page) => Promise<void>;
  phase4?: boolean;
}
const q = (p: string): string => `${p}${p.includes('?') ? '&' : '?'}${WIDE_UI}`;
export const CORE_ROUTES: RouteDef[] = [
  { name: 'overview', path: () => q('/') },
  { name: 'projects', path: () => q('/projects') },
  { name: 'project-detail', path: (d) => q(`/projects/${encodeURIComponent(d.topProject.id)}`) },
  { name: 'sessions', path: () => q('/sessions') },
  { name: 'session-detail', path: (d) => q(`/sessions/${encodeURIComponent((d.sessionWithAgent ?? d.anySession)?.id ?? 'none')}`) },
  { name: 'agents-graph', path: () => q('/agents'), after: async (p) => { await p.getByRole('button', { name: t('agents.view.graph') }).click(); } },
  { name: 'agents-list', path: () => q('/agents'), after: async (p) => { await p.getByRole('button', { name: t('agents.view.list') }).click(); } },
  { name: 'settings', path: () => '/settings' },
];
export const PHASE4_ROUTES: (RouteDef & { candidates: string[] })[] = [
  { name: 'timeline', path: () => q('/timeline'), candidates: ['/timeline'], phase4: true },
  { name: 'costs', path: () => q('/costs'), candidates: ['/costs'], phase4: true },
  { name: 'reports', path: () => q('/reports'), candidates: ['/reports'], phase4: true },
  { name: 'story', path: () => q('/reports/story'), candidates: ['/story', '/reports/story'], phase4: true },
];

/** Waits until the SPA has rendered a heading and finished loading skeletons and finite animations. */
export async function ready(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  await expect(page.locator('h1').first()).toBeVisible();
  await expect(page.locator('.skeleton')).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
}

/** In AppShell the nav is in the sidebar (desktop) or a drawer behind the menu button (mobile). */
export async function navTo(page: Page, key: string): Promise<void> {
  const name = t(key);
  const menu = page.getByRole('button', { name: t('nav.openMenu') });
  if (await menu.isVisible()) {
    await menu.click();
    await page.getByRole('dialog').getByRole('link', { name }).click();
  } else {
    await page.getByRole('navigation', { name: t('nav.main') }).getByRole('link', { name }).click();
  }
}

/** true when the SPA route renders something other than the 404 page (the 404 page has no h1, so match on its text). */
export async function routeExists(page: Page, path: string): Promise<boolean> {
  await page.goto(path);
  await page.waitForLoadState('load');
  await expect(page.locator('main h1, main .state h3').first()).toBeVisible();
  return (await page.getByText(t('notfound.title'), { exact: true }).count()) === 0;
}

/** Returns the first existing phase-4 path (with wide filters) or null when the UI has not landed yet. */
export async function findPhase4Path(page: Page, candidates: string[]): Promise<string | null> {
  for (const c of candidates) {
    const p = q(c);
    if (await routeExists(page, p)) return p;
  }
  return null;
}

/** Fails the test if any JS dialog (alert/confirm/prompt/beforeunload) opens. */
export function failOnDialog(page: Page): { opened: string[] } {
  const state = { opened: [] as string[] };
  page.on('dialog', (d) => {
    state.opened.push(`${d.type()}:${d.message()}`);
    void d.dismiss();
  });
  return state;
}
