import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const MAIN = 'http://127.0.0.1:4450';
export const FRESH = 'http://127.0.0.1:4451';
export const sourceRoot = (): string => join(process.env.ORBIT_E2E_ROOT as string, 'source');

// ---------------------------------------------------------------- i18n (Turkish strings are the single source of truth)
const loadJson = (rel: string): Record<string, string> => JSON.parse(readFileSync(new URL(`../../apps/web/src/i18n/locales/${rel}`, import.meta.url), 'utf8')) as Record<string, string>;
// Same merge order as apps/web/src/i18n/registry.ts (base + shell + merkez + ask module catalogs).
const tr: Record<string, string> = Object.assign({}, loadJson('tr.json'), loadJson('modules/shell.tr.json'), loadJson('modules/merkez.tr.json'), loadJson('modules/ask.tr.json'));
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
/** Same-year range covering all synthetic data (Mar..Nov 2026): keeps the compact mobile top-bar label short. */
export const MOBILE_UI = 'from=2026-03-02&to=2026-11-30';
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
  { name: 'merkez', path: () => q('/bolum/merkez') },
  { name: 'planned-zaman', path: () => q('/bolum/zaman') },
  { name: 'projects', path: () => q('/projects') },
  { name: 'project-detail', path: (d) => q(`/projects/${encodeURIComponent(d.topProject.id)}`) },
  { name: 'sessions', path: () => q('/sessions') },
  { name: 'session-detail', path: (d) => q(`/sessions/${encodeURIComponent((d.sessionWithAgent ?? d.anySession)?.id ?? 'none')}`) },
  { name: 'agents-graph', path: () => q('/agents'), after: async (p) => { await p.getByRole('button', { name: t('agents.view.graph') }).click(); } },
  { name: 'agents-list', path: () => q('/agents'), after: async (p) => { await p.getByRole('button', { name: t('agents.view.list') }).click(); } },
  { name: 'settings', path: () => '/settings' },
  { name: 'notfound-scene', path: () => '/bolum/yok-boyle-bir-bolum' },
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
  await expect(page.locator('.skeleton, .mz-skeleton')).toHaveCount(0, { timeout: 15_000 });
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))));
}

/** true when the SPA route renders something other than the 404 page (the 404 page has no h1, so match on its text). */
export async function routeExists(page: Page, path: string): Promise<boolean> {
  await page.goto(path);
  await page.waitForLoadState('load');
  await expect(page.locator('main h1, main .state h3').first()).toBeVisible();
  return (await page.getByRole('heading', { level: 1, name: t('shell.notfound.title') }).count()) === 0;
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

// ---------------------------------------------------------------- shell helpers (ADR-003)
export const ASK = '[data-orbit-ask-input]';
export const MONEY_RE = /Pro\/Max/;
export const MONEY_LABEL_RE = new RegExp(t('money.short').replace(/ \(USD\)$/, ''), 'i');

/** Opens a shell route with the wide range and waits for the scene. */
export async function openScene(page: Page, path = '/bolum/merkez', range: string = WIDE_UI): Promise<void> {
  await page.goto(`${path}${path.includes('?') ? '&' : '?'}${range}`);
  await ready(page);
}

export interface MerkezNumbers {
  /** exact (full precision) from the visually-hidden tables / title attributes */
  processedTokens: number;
  requests: number;
  sessions: number;
  subagents: number;
  cachePctText: string;
  usdText: string;
  sunText: string;
  headline: string;
}
/** Reads what Scene 01 actually displays. Compact readouts expose the exact number via title / sr-only table. */
export async function readMerkez(page: Page): Promise<MerkezNumbers> {
  const ro = (k: string) => page.locator(`.scene-slot [data-readout="${k}"]`);
  const byLabel = (label: string) => page.locator('.scene-slot .mz-ro', { has: page.getByRole('heading', { name: label, exact: true }) }).locator('.mz-ro-val');
  const tokensTitle = await ro('tokens').locator('button.mz-ro-btn').getAttribute('title');
  return {
    processedTokens: parseTrNumber(tokensTitle ?? ''),
    requests: parseTrNumber(await byLabel(t('scene.merkez.ro.requests')).innerText()),
    sessions: parseTrNumber(await byLabel(t('scene.merkez.ro.sessions')).innerText()),
    subagents: parseTrNumber(await byLabel(t('scene.merkez.ro.subagents')).innerText()),
    cachePctText: (await byLabel(t('scene.merkez.ro.cache')).innerText()).trim(),
    usdText: (await ro('value').locator('.money-v').innerText()).trim(),
    sunText: (await page.locator('.scene-slot .mz-sun-val').textContent())?.trim() ?? '',
    headline: (await page.locator('.scene-slot h1').innerText()).trim(),
  };
}

/** Same tr-TR compact format as apps/web/src/i18n/format.ts (suffixes read from tr.json). */
export function trCompact(n: number): string {
  const abs = Math.abs(n);
  const nf = (v: number) => new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 }).format(v);
  if (abs < 1000) return new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(n);
  const keys = ['thousand', 'million', 'billion'];
  const divs = [1e3, 1e6, 1e9];
  let i = abs >= 1e9 ? 2 : abs >= 1e6 ? 1 : 0;
  let v = n / (divs[i] as number);
  if (Math.abs(Math.round(v * 10) / 10) >= 1000 && i < 2) { i += 1; v = n / (divs[i] as number); }
  return nf(v) + (tr[`format.compact.${keys[i] as string}`] ?? '');
}
export const trUsd = (v: string | number): string => {
  const n = Number(v);
  const small = n !== 0 && Math.abs(n) < 0.01;
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: small ? 4 : 2 }).format(n);
};
export const trPct = (r: number, digits = 0): string => new Intl.NumberFormat('tr-TR', { style: 'percent', maximumFractionDigits: digits }).format(r);
export const norm = (s: string): string => s.replace(/[\u00a0\u202f]/g, ' ');

/** Submits a question / command to Orbit Ask. */
export async function ask(page: Page, text: string): Promise<void> {
  const input = page.locator(ASK);
  // focus() instead of click(): on the current mobile build Playwright cannot hit-test the input (see delivery1.spec.ts "tap" probe)
  await input.focus();
  await input.fill(text);
  await input.press('Enter');
}
export const askCard = (page: Page) => page.locator('.ask-card[data-status]');
