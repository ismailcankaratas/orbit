import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { ExperienceContext, type ExperienceActions } from '../experience/context';
import { renderWith, mockFetch } from '../test/utils';
import { coverage, cost, tokens } from '../test/dto';
import { OrbitAsk } from './OrbitAsk';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const overviewBody = {
  mode: 'demo',
  period: { from: '2026-09-16T00:00:00.000Z', to: '2026-10-16T00:00:00.000Z', tz: 'Europe/Istanbul' },
  asOf: '2026-10-15T09:00:00Z',
  revision: 1,
  kpis: {
    uniqueRequests: { value: 100, quality: 'observed' },
    tokens: { ...tokens, quality: 'observed' },
    cost: cost(),
    sessions: { value: 7, quality: 'observed' },
    projects: { value: 2, quality: 'observed' },
    subagents: { value: 3, quality: 'observed' },
  },
  previous: null,
  daily: [],
  models: [],
  topProjects: [],
  agentLanes: [],
  insights: [],
  coverage,
};

let actions: ExperienceActions;
function mount(ui: ReactElement = <OrbitAsk />) {
  actions = {
    activeChapter: 'merkez',
    goToChapter: vi.fn(),
    openCatalog: vi.fn(),
    openHelp: vi.fn(),
    openSettings: vi.fn(),
    openExplorer: vi.fn(),
    announce: vi.fn(),
  };
  return renderWith(<ExperienceContext.Provider value={actions}>{ui}</ExperienceContext.Provider>, { route: '/bolum/merkez' });
}
const input = () => screen.getByRole('combobox') as HTMLInputElement;
const type = (v: string) => fireEvent.change(input(), { target: { value: v } });

beforeEach(() => {
  mockFetch({ '/api/v1/overview': overviewBody, '/api/v1/projects': { items: [], total: 0, nextCursor: null } });
});

describe('OrbitAsk', () => {
  it('exposes the field with label, placeholder and the shell focus hook', () => {
    mount();
    expect(input().hasAttribute('data-orbit-ask-input')).toBe(true);
    expect(input().getAttribute('placeholder')).toBe('Bir soru sorun veya / yazın');
    expect(input().getAttribute('aria-label')).toBe("Orbit'e sor");
    expect(input().getAttribute('aria-expanded')).toBe('false');
  });

  it('typing "/" shows an accessible suggestion listbox; planned chapters are disabled with a reason', () => {
    mount();
    type('/');
    const list = screen.getByRole('listbox');
    expect(input().getAttribute('aria-expanded')).toBe('true');
    expect(input().getAttribute('aria-controls')).toBe(list.id);
    const options = within(list).getAllByRole('option');
    expect(options.length).toBeGreaterThan(20);
    const planned = options.find((o) => o.textContent?.includes('/yorungeler'));
    expect(planned?.getAttribute('aria-disabled')).toBe('true');
    expect(planned?.textContent).toContain('Henüz hazır değil');
    const ready = options.find((o) => o.textContent?.includes('/merkez'));
    expect(ready?.getAttribute('aria-disabled')).toBeNull();
  });

  it('filters suggestions as you type (diacritics folded)', () => {
    mount();
    type('/dışa');
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.map((o) => o.textContent).join(' ')).toContain('/dışa-aktar csv');
    expect(options.length).toBeGreaterThanOrEqual(2);
  });

  it('ArrowDown + Enter runs the highlighted command', async () => {
    mount();
    type('/');
    fireEvent.keyDown(input(), { key: 'ArrowDown' });
    const first = screen.getAllByRole('option')[0] as HTMLElement;
    expect(input().getAttribute('aria-activedescendant')).toBe(first.id);
    expect(first.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(input(), { key: 'Enter' });
    await waitFor(() => expect(actions.openCatalog).toHaveBeenCalledTimes(1)); // first entry = /bölümler
    expect(input().value).toBe('');
  });

  it('typing /merkez + Enter navigates to a ready chapter', async () => {
    mount();
    type('/merkez');
    fireEvent.keyDown(input(), { key: 'Enter' });
    await waitFor(() => expect(actions.goToChapter).toHaveBeenCalledWith('merkez'));
  });

  it('a planned chapter shows "not ready" and does not navigate', async () => {
    mount();
    type('/yörüngeler');
    fireEvent.keyDown(input(), { key: 'Enter' });
    await screen.findByText(/henüz hazır değil/i, { selector: '.ask-text' });
    expect(actions.goToChapter).not.toHaveBeenCalled();
  });

  it('Enter on a question renders the answer card inside an aria-live region, with caveat and evidence link', async () => {
    const { container } = mount();
    type('tahmini değer ne kadar');
    fireEvent.keyDown(input(), { key: 'Enter' });
    const card = await waitFor(() => {
      const el = container.querySelector('.ask-card[data-status="answered"]');
      if (!el) throw new Error('no card yet');
      return el as HTMLElement;
    });
    expect(card.closest('[aria-live="polite"]')).not.toBeNull();
    expect(card.textContent).toContain('$12,35');
    expect(card.textContent).toContain('Tahmini API eşdeğeri değer (USD) — Pro/Max faturası değildir');
    expect(card.textContent).not.toMatch(/harca/i);
    expect(within(card).getByRole('link').getAttribute('href')).toMatch(/^\/costs/);
  });

  it('unsupported questions show guidance and four clickable examples', async () => {
    mount();
    type('bana bir şiir yaz');
    fireEvent.keyDown(input(), { key: 'Enter' });
    await screen.findByText('Bunu henüz yanıtlayamıyorum.');
    const chips = document.querySelectorAll('.ask-card .ask-chip');
    expect(chips).toHaveLength(4);
    fireEvent.click(chips[0] as HTMLElement);
    await waitFor(() => expect(document.querySelector('.ask-card[data-status="answered"]')).not.toBeNull());
    expect(input().value).toBe('Son 7 günde kaç oturum var?');
  });

  it('shows example chips on focus when empty', () => {
    mount();
    expect(document.querySelector('.ask-chip')).toBeNull();
    fireEvent.focus(input());
    expect(document.querySelectorAll('.ask-chips-wrap .ask-chip')).toHaveLength(3);
  });

  it('Esc clears the answer and the text; a second Esc blurs', async () => {
    mount();
    input().focus();
    type('kaç oturum');
    fireEvent.keyDown(input(), { key: 'Enter' });
    await waitFor(() => expect(document.querySelector('.ask-card[data-status="answered"]')).not.toBeNull());
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(document.querySelector('.ask-card')).toBeNull();
    expect(input().value).toBe('');
    expect(document.activeElement).toBe(input());
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(document.activeElement).not.toBe(input());
  });

  it('Esc closes the suggestion list', () => {
    mount();
    type('/');
    expect(screen.queryByRole('listbox')).not.toBeNull();
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('input text is never written to localStorage', async () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem');
    mount();
    type('kaç oturum');
    fireEvent.keyDown(input(), { key: 'Enter' });
    await waitFor(() => expect(document.querySelector('.ask-card[data-status="answered"]')).not.toBeNull());
    expect(spy.mock.calls.some(([, v]) => String(v).includes('kaç oturum'))).toBe(false);
    spy.mockRestore();
  });
});
