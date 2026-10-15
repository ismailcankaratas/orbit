import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { OverviewDTO, ProjectSummary, TokenTotals } from '@orbit/core';
import { renderWith, mockFetch } from '../../test/utils';
import { cost, coverage, period, storyDto, tokens } from '../../test/dto';
import { ExperienceContext, type ExperienceActions } from '../../experience/context';
import { MerkezScene } from './index';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const tk = (processed: number): TokenTotals => ({ ...tokens, processed });
const project = (i: number, label: string, processed: number, over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id: `p_${String(i).padStart(12, '0')}`, alias: null, label, shortCode: `c${i}`, nameCollision: false, sessions: 3 + i, requests: 30 + i, agents: i, tokens: tk(processed), usdDecimal: '4.000000', unpricedRequests: 0, lastActiveAt: '2026-10-14T10:00:00Z', trend: [1, 2], sourcePresent: true, ...over,
});

function overview(over: Partial<OverviewDTO> = {}, projects: ProjectSummary[] = []): OverviewDTO {
  return {
    mode: 'demo', period, asOf: '2026-10-15T00:00:00Z', revision: 1,
    kpis: {
      uniqueRequests: { value: 1566, quality: 'observed' },
      tokens: { ...tokens, processed: 37_300_000, cacheRead: 29_840_000, quality: 'observed' },
      cost: cost({ requestCoverage: 0.9 }),
      sessions: { value: 98, quality: 'observed' },
      projects: { value: 7, quality: 'observed' },
      subagents: { value: 12, quality: 'observed' },
    },
    previous: { uniqueRequests: 1000, processedTokens: 30_000_000, usdDecimal: '10.000000', sessions: 80, requestCoverage: 0.9 },
    daily: [],
    models: [
      { modelId: 'claude-sonnet-5', displayName: 'Claude Sonnet 5', requests: 1200, tokens: tk(30_000_000), usdDecimal: '10.000000', priced: true },
      { modelId: 'claude-mystery-9', displayName: null, requests: 366, tokens: tk(7_300_000), usdDecimal: null, priced: false },
    ],
    topProjects: projects.slice(0, 5), agentLanes: [], insights: [], coverage,
    ...over,
  };
}

const PROJECTS = [project(1, 'aurora-api', 20_000_000), project(2, '<img src=x onerror=alert(1)>', 9_000_000), project(3, 'zeta', 5_000_000)];

function setup(ov: OverviewDTO, opts: { projects?: ProjectSummary[]; actions?: Partial<ExperienceActions> } = {}) {
  const ps = opts.projects ?? PROJECTS;
  mockFetch({
    '/api/v1/overview': ov,
    '/api/v1/projects': { items: ps, total: ps.length, nextCursor: null },
    '/api/v1/reports/summary': storyDto(),
  });
  const actions: ExperienceActions = { activeChapter: 'merkez', goToChapter: vi.fn(), openCatalog: vi.fn(), openHelp: vi.fn(), openSettings: vi.fn(), openExplorer: vi.fn(), announce: vi.fn(), ...opts.actions };
  const utils = renderWith(
    <ExperienceContext.Provider value={actions}>
      <MerkezScene goToChapter={() => undefined} active />
    </ExperienceContext.Provider>,
    { route: '/bolum/merkez?from=2026-09-16&to=2026-10-15' },
  );
  return { ...utils, actions };
}

describe('MerkezScene', () => {
  it('renders the headline and subline from the OverviewDTO', async () => {
    setup(overview());
    const h = await screen.findByRole('heading', { level: 1 });
    expect(h.textContent).toBe('30 günde 7 proje, 98 oturum.');
    expect(document.body.textContent).toContain('1.566 benzersiz API isteği, 37,3 Mn işlenen token');
  });

  it('labels the money readout as estimated API-equivalent value with the Pro/Max caveat', async () => {
    setup(overview());
    await screen.findByRole('heading', { level: 1 });
    const ro = document.querySelector('[data-readout="value"]') as HTMLElement;
    expect(ro.textContent).toContain('Tahmini API eşdeğeri değer (USD)');
    expect(ro.textContent).toContain('Pro/Max faturası değildir');
    expect(ro.textContent).toContain('$12,35');
  });

  it('planets are focusable buttons and selecting one updates the detail area', async () => {
    const { actions } = setup(overview());
    const detail = await screen.findByRole('region', { name: 'Seçim ayrıntısı' });
    await waitFor(() => expect(within(detail).getByRole('heading', { name: 'aurora-api' })).toBeTruthy());
    const zeta = screen.getByRole('button', { name: /Proje zeta/ });
    expect(zeta.getAttribute('tabindex')).toBeDefined();
    zeta.focus();
    fireEvent.focus(zeta);
    await waitFor(() => expect(within(detail).getByRole('heading', { name: 'zeta' })).toBeTruthy());
    fireEvent.click(within(detail).getByRole('button', { name: 'Veri gezgininde aç' }));
    expect(actions.openExplorer).toHaveBeenCalledWith('/projects/p_000000000003');
  });

  it('ArrowRight inside the orbit moves selection and does not reach global listeners', async () => {
    setup(overview());
    await screen.findByRole('region', { name: 'Seçim ayrıntısı' });
    const global = vi.fn();
    window.addEventListener('keydown', global);
    const first = screen.getAllByRole('button', { name: /^Proje / })[0] as HTMLElement;
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    window.removeEventListener('keydown', global);
    expect(global).not.toHaveBeenCalled();
    const detail = screen.getByRole('region', { name: 'Seçim ayrıntısı' });
    await waitFor(() => expect(within(detail).getByRole('heading', { name: '<img src=x onerror=alert(1)>' })).toBeTruthy());
  });

  it('marks the unknown model arc as unpriced and explains it in the detail', async () => {
    setup(overview());
    const arc = await screen.findByRole('button', { name: /claude-mystery-9.*fiyatsız/ });
    fireEvent.click(arc);
    const detail = screen.getByRole('region', { name: 'Seçim ayrıntısı' });
    await waitFor(() => expect(detail.textContent).toContain('fiyatsız (toplama dahil değil)'));
    expect(document.querySelector('.mz-arc-unpriced')).not.toBeNull();
  });

  it('shows the previous-period comparison only when comparable', async () => {
    const { unmount } = setup(overview());
    await screen.findByRole('heading', { level: 1 });
    expect(document.body.textContent).toContain('+');
    unmount();
    setup(overview({ previous: null }));
    await waitFor(() => expect(document.body.textContent).toContain('Karşılaştırma yok'));
  });

  it('empty overview makes no numeric claims and offers settings', async () => {
    const empty = overview({
      kpis: { ...overview().kpis, uniqueRequests: { value: 0, quality: 'observed' }, sessions: { value: 0, quality: 'observed' }, projects: { value: 0, quality: 'observed' }, subagents: { value: 0, quality: 'observed' }, tokens: { ...tokens, uncachedInput: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, processed: 0, quality: 'observed' } },
      models: [], topProjects: [], previous: null, coverage: { ...coverage, uniqueRequests: 0, sourceStatus: 'empty' },
    });
    const { actions } = setup(empty, { projects: [] });
    const h = await screen.findByRole('heading', { level: 1 });
    expect(h.textContent).toBe('Bu aralıkta kayıt yok.');
    expect(document.querySelector('[data-readout]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/proje, \d+ oturum/);
    fireEvent.click(screen.getByRole('button', { name: 'Ayarları aç' }));
    expect(actions.openSettings).toHaveBeenCalled();
  });

  it('has no agent-control buttons', async () => {
    setup(overview());
    await screen.findByRole('heading', { level: 1 });
    for (const b of screen.getAllByRole('button')) expect(b.getAttribute('aria-label') ?? b.textContent ?? '').not.toMatch(/ata|duraklat|durdur|assign|pause|stop|restart/i);
  });

  it('renders hostile project names as text only', async () => {
    const { container } = setup(overview());
    await screen.findByRole('heading', { level: 1 });
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getAllByText('<img src=x onerror=alert(1)>').length).toBeGreaterThan(0);
  });
});
