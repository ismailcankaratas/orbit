import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useLocation } from 'react-router-dom';
import type { Page, ProjectSummary, StatusDTO } from '@orbit/core';
import { mockFetch, renderWith } from '../test/utils';
import { ExperienceShell } from './ExperienceShell';
import { ShellRoutes } from '../App';

// Scene 01 and Orbit Ask are other modules: isolate the shell with minimal stand-ins.
vi.mock('../experience/scenes', () => ({
  SCENES: { merkez: () => <h1>scene-merkez</h1> },
}));
vi.mock('../ask', () => ({
  OrbitAsk: () => <input data-orbit-ask-input aria-label="ask-stub" />,
}));

const status: StatusDTO = {
  mode: 'demo', consentGranted: true, sourceLabel: null, archiveEnabled: false,
  scan: { state: 'idle', startedAt: null, finishedAt: null, filesTotal: 0, filesDone: 0, lastError: null },
  watcher: 'watching', lastScanAt: '2026-10-15T08:30:00Z', revision: 1, version: '0.0.0',
};

function Probe() {
  const l = useLocation();
  return <output data-testid="loc">{l.pathname}{l.search}</output>;
}

function app(route = '/bolum/merkez') {
  return renderWith(
    <ExperienceShell status={status}>
      <Probe />
      <ShellRoutes />
    </ExperienceShell>,
    { route },
  );
}
const loc = () => screen.getByTestId('loc').textContent;
const press = (key: string, init: KeyboardEventInit = {}) => act(() => { fireEvent.keyDown(document.body, { key, ...init }); });

beforeEach(() => {
  mockFetch({});
  vi.stubGlobal('ResizeObserver', class { observe() { /* jsdom has no layout */ } unobserve() { /* noop */ } disconnect() { /* noop */ } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.documentElement.className = '';
});

describe('shell structure', () => {
  it('has no sidebar and no navigation landmark listing feature pages', () => {
    const { container } = app();
    expect(container.querySelector('.sidebar, aside, .nav')).toBeNull();
    expect(screen.queryAllByRole('navigation')).toEqual([]);
    for (const name of ['Projeler', 'Oturumlar', 'Ajanlar', 'Maliyetler', 'Raporlar']) expect(screen.queryByRole('link', { name })).toBeNull();
    expect(screen.getByRole('banner')).toBeTruthy();
    expect(screen.getByRole('main')).toBeTruthy();
    expect(screen.getByRole('contentinfo')).toBeTruthy();
  });

  it('redirects / to Merkez keeping the query string and renders the ready scene', () => {
    app('/?range=7');
    expect(loc()).toBe('/bolum/merkez?range=7');
    expect(screen.getByText('scene-merkez')).toBeTruthy();
    expect(screen.getByTestId('rail-position').textContent).toBe('01 / 12 · Merkez');
  });

  it('shows the demo badge and a compact notice instead of a full-width banner', () => {
    const { container } = app();
    expect(screen.getByText('Demo — sentetik veri')).toBeTruthy();
    expect(screen.getByTestId('demo-note')).toBeTruthy();
    expect(container.querySelector('.demo-banner')).toBeNull();
  });

  it('planned chapter route shows an honest not-ready state with a way back', () => {
    app('/bolum/yorungeler');
    expect(screen.getByRole('heading', { level: 1, name: 'Bu bölüm henüz hazır değil' })).toBeTruthy();
    expect(screen.getByText(/Sahte veri göstermiyoruz/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Merkez'e dön/ }));
    expect(loc()).toBe('/bolum/merkez');
  });

  it('unknown route shows a 404 scene with a heading', () => {
    app('/nope');
    expect(screen.getByRole('heading', { level: 1, name: 'Bölüm bulunamadı' })).toBeTruthy();
  });

  it('renders the legacy /projects view inside the explorer frame (no persistent nav link)', async () => {
    const tokens = { uncachedInput: 1, output: 1, cacheRead: 1, cacheWrite5m: 0, cacheWrite1h: 0, unsplitCacheWrite: 0, processed: 3 };
    const page: Page<ProjectSummary> = { items: [{ id: 'p1', alias: null, label: 'demo-app', shortCode: 'ab12', nameCollision: false, sessions: 1, requests: 2, agents: 0, tokens, usdDecimal: '0.010000', unpricedRequests: 0, lastActiveAt: '2026-10-14T10:00:00Z', trend: [1, 2], sourcePresent: true }], total: 1, nextCursor: null };
    mockFetch({ '/api/v1/projects': page, '/api/v1/overview': { models: [] } });
    app('/projects?range=7');
    const frame = screen.getByTestId('explorer-frame');
    expect(within(frame).getByText(/Veri gezgini · Projeler/)).toBeTruthy();
    await waitFor(() => expect(within(frame).getAllByText('demo-app').length).toBeGreaterThan(0));
    expect(screen.getByTestId('rail-position').textContent).toBe('Veri gezgini');
    fireEvent.click(within(frame).getByRole('button', { name: /Merkez'e dön/ }));
    expect(loc()).toBe('/bolum/merkez?range=7');
  });
});

describe('chapter rail', () => {
  it('disables prev/next with a reason when no ready neighbour exists and announces it', () => {
    app();
    const prev = screen.getByRole('button', { name: 'Önceki bölüm' });
    const next = screen.getByRole('button', { name: 'Sonraki bölüm' });
    expect(prev.getAttribute('aria-disabled')).toBe('true');
    expect(next.getAttribute('aria-disabled')).toBe('true');
    expect(next.getAttribute('title')).toBe('Sonraki bölüm henüz hazır değil');
    fireEvent.click(next);
    expect(screen.getByTestId('live-region').textContent?.trim()).toBe('Sonraki bölüm henüz hazır değil');
    press('ArrowRight');
    expect(loc()).toBe('/bolum/merkez');
  });

  it('renders 12 dots: the ready one is current, planned ones are aria-disabled with a description', () => {
    app();
    const dots = within(screen.getByRole('list', { name: 'Bölüm ilerlemesi' })).getAllByRole('button');
    expect(dots).toHaveLength(12);
    expect(dots[0]?.getAttribute('aria-current')).toBe('step');
    expect(dots[0]?.getAttribute('aria-disabled')).toBeNull();
    expect(dots[0]?.getAttribute('aria-label')).toBe('01. bölüm: Merkez');
    for (const d of dots.slice(1)) {
      expect(d.getAttribute('aria-disabled')).toBe('true');
      const desc = document.getElementById(d.getAttribute('aria-describedby') ?? '');
      expect(desc?.textContent).toBe('Henüz hazır değil');
    }
    fireEvent.click(dots[3] as HTMLElement);
    expect(loc()).toBe('/bolum/merkez');
  });
});

describe('chapter catalog', () => {
  it('C opens, arrows + Enter handle ready/planned entries, Esc closes and restores focus', async () => {
    app();
    const opener = screen.getByRole('button', { name: 'Bölümleri aç' });
    opener.focus();
    press('c');
    const dialog = await screen.findByRole('dialog', { name: 'Bölümler' });
    const input = within(dialog).getByRole('combobox');
    expect(document.activeElement).toBe(input);
    expect(within(dialog).getAllByRole('option')).toHaveLength(12);
    // Merkez (current, ready) is active; Enter goes there
    expect(input.getAttribute('aria-activedescendant')).toMatch(/merkez$/);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toMatch(/yorungeler$/);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByTestId('catalog-reason').textContent).toBe('Yörüngeler bölümü henüz hazır değil.');
    expect(loc()).toBe('/bolum/merkez');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(loc()).toBe('/bolum/merkez');
    // reopen from a planned page, go back to the ready chapter with filter
    press('c');
    const d2 = await screen.findByRole('dialog', { name: 'Bölümler' });
    fireEvent.change(within(d2).getByRole('combobox'), { target: { value: 'mer' } });
    expect(within(d2).getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('navigates to a ready chapter from a planned route via ↓/Enter after filtering', async () => {
    app('/bolum/oturumlar');
    press('C');
    const d = await screen.findByRole('dialog', { name: 'Bölümler' });
    const input = within(d).getByRole('combobox');
    fireEvent.change(input, { target: { value: 'merkez' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(loc()).toBe('/bolum/merkez');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('accepts an initial filter from openCatalog and is reachable via the rail button', async () => {
    app();
    fireEvent.click(screen.getByRole('button', { name: 'Bölümleri aç' }));
    expect(await screen.findByRole('dialog', { name: 'Bölümler' })).toBeTruthy();
  });
});

describe('help overlay and keyboard', () => {
  it('? opens help listing shortcuts and Ask examples; Esc closes', async () => {
    app();
    press('?', { shiftKey: true });
    const d = await screen.findByRole('dialog', { name: 'Klavye kısayolları' });
    expect(within(d).getByText('Bölüm listesini aç')).toBeTruthy();
    expect(within(d).getByText('/bölümler')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('"/" focuses Orbit Ask when not typing, and shortcuts are ignored while typing', () => {
    app();
    const ask = document.querySelector<HTMLInputElement>('[data-orbit-ask-input]');
    expect(ask).not.toBeNull();
    press('/');
    expect(document.activeElement).toBe(ask);
    // typing in the Ask field must not trigger C / ? / arrows
    fireEvent.keyDown(ask as HTMLElement, { key: 'c' });
    fireEvent.keyDown(ask as HTMLElement, { key: '?' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('date selector', () => {
  it('shows a compact range button; a preset updates URL params', async () => {
    app('/bolum/merkez?from=2026-09-16&to=2026-10-15');
    const btn = screen.getByRole('button', { name: /Tarih aralığı: .*Değiştirmek için açın/ });
    expect(screen.getByTestId('range-summary').textContent).toBe('16 Eyl – 15 Eki 2026');
    fireEvent.click(btn);
    const panel = await screen.findByRole('dialog', { name: 'Tarih aralığı' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Son 7 gün' }));
    expect(loc()).toMatch(/range=7/);
    expect(loc()).not.toMatch(/from=/);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('applies a custom range and blocks an invalid one', async () => {
    app('/bolum/merkez?range=30');
    fireEvent.click(screen.getByRole('button', { name: /Tarih aralığı/ }));
    const panel = await screen.findByRole('dialog', { name: 'Tarih aralığı' });
    const from = within(panel).getByLabelText('Başlangıç tarihi');
    const to = within(panel).getByLabelText('Bitiş tarihi');
    fireEvent.change(from, { target: { value: '2026-10-20' } });
    fireEvent.change(to, { target: { value: '2026-10-01' } });
    expect((within(panel).getByRole('button', { name: 'Uygula' }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(panel).getByRole('alert')).toBeTruthy();
    fireEvent.change(from, { target: { value: '2026-10-01' } });
    fireEvent.change(to, { target: { value: '2026-10-10' } });
    fireEvent.click(within(panel).getByRole('button', { name: 'Uygula' }));
    expect(loc()).toMatch(/from=2026-10-01/);
    expect(loc()).toMatch(/to=2026-10-10/);
  });
});

describe('settings and i18n', () => {
  it('settings button opens the settings panel inside a dialog', async () => {
    mockFetch({ '/api/v1/settings': { consentGranted: true, sourceLabel: '~/.claude/projects', sourceIsDefault: true, archiveEnabled: false, watchIntervalMs: 5000, locale: 'tr', timezone: 'Europe/Istanbul', activeDataset: 'demo', rateOverrides: [], dataDirLabel: '~/.orbit' } });
    app();
    fireEvent.click(screen.getByRole('button', { name: 'Ayarlar' }));
    expect(await screen.findByRole('dialog', { name: 'Ayarlar' })).toBeTruthy();
  });

  it('English locale renders English chapter titles', () => {
    renderWith(<ExperienceShell status={status}><ShellRoutes /></ExperienceShell>, { route: '/bolum/merkez', locale: 'en' });
    expect(screen.getByTestId('rail-position').textContent).toBe('01 / 12 · Center');
  });
});
