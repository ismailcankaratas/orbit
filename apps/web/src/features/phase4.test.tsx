import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { EXPORT_COLUMNS, MONEY_LABEL_EN, MONEY_LABEL_TR } from '@orbit/core';
import type { SettingsDTO } from '@orbit/core';
import { mockFetch, renderWith } from '../test/utils';
import { costsDto, storyDto, timelineDto } from '../test/dto';
import { Costs } from './costs/Costs';
import { emptyDraft, validateDraft } from './costs/rates';
import { PrivacyPreview, Reports } from './reports/Reports';
import { Story } from './reports/Story';
import { TimelineBody } from './timeline/Timeline';
import { Timeline } from './timeline/Timeline';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() { /* jsdom has no layout */ } unobserve() { /* noop */ } disconnect() { /* noop */ } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const settings: SettingsDTO = { consentGranted: true, sourceLabel: '~/.claude/projects', sourceIsDefault: true, archiveEnabled: false, watchIntervalMs: 5000, locale: 'tr', timezone: 'Europe/Istanbul', activeDataset: 'demo', rateOverrides: [], dataDirLabel: '~/.orbit' };
const BAD = /\b(ata|görevi ata|duraklat|durdur|yeniden başlat|assign|pause|stop|restart|resume|kill)\b/i;

function storyApp(over: Parameters<typeof storyDto>[0] = {}) {
  mockFetch({ '/api/v1/reports/summary': storyDto(over) });
  return renderWith(
    <Routes>
      <Route path="/reports/story" element={<Story />} />
      <Route path="/reports" element={<p>reports-page</p>} />
    </Routes>,
    { route: '/reports/story' },
  );
}
const index = () => screen.getByTestId('story-index').textContent;
const key = (k: string) => act(() => { fireEvent.keyDown(document.body, { key: k }); });

describe('Story Mode', () => {
  it('navigates with keys and exits with Escape', async () => {
    storyApp();
    await waitFor(() => expect(index()).toBe('1 / 8'));
    key('ArrowRight');
    await waitFor(() => expect(index()).toBe('2 / 8'));
    key(' ');
    await waitFor(() => expect(index()).toBe('3 / 8'));
    key('PageUp');
    await waitFor(() => expect(index()).toBe('2 / 8'));
    key('End');
    await waitFor(() => expect(index()).toBe('8 / 8'));
    key('ArrowRight');
    expect(index()).toBe('8 / 8');
    key('Home');
    await waitFor(() => expect(index()).toBe('1 / 8'));
    key('Escape');
    await waitFor(() => expect(screen.getByText('reports-page')).toBeTruthy());
  });

  it('buttons match keys and the live region announces the slide', async () => {
    storyApp();
    await waitFor(() => expect(index()).toBe('1 / 8'));
    fireEvent.click(screen.getByRole('button', { name: 'Sonraki' }));
    await waitFor(() => expect(index()).toBe('2 / 8'));
    expect(screen.getAllByRole('status').some((n) => /Slayt 2 \/ 8/.test(n.textContent ?? ''))).toBe(true);
    expect((screen.getByRole('button', { name: 'Önceki' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('every slide with USD carries the estimated API-equivalent label; each slide has a takeaway and a drilldown', async () => {
    storyApp();
    await waitFor(() => expect(index()).toBe('1 / 8'));
    let withUsd = 0;
    for (let i = 1; i <= 8; i++) {
      const slide = screen.getByTestId('slide-active');
      const text = slide.textContent ?? '';
      if (/\$/.test(text)) {
        withUsd += 1;
        expect(text).toContain(MONEY_LABEL_TR);
      }
      expect(within(slide).getByRole('link', { name: /Veriyi gör/ })).toBeTruthy();
      expect(slide.querySelector('.takeaway')?.textContent?.length ?? 0).toBeGreaterThan(5);
      if (i < 8) { key('ArrowRight'); await waitFor(() => expect(index()).toBe(`${i + 1} / 8`)); }
    }
    expect(withUsd).toBeGreaterThanOrEqual(1);
  });

  it('marks demo data with a watermark and makes no claims on empty data', async () => {
    storyApp({ mode: 'demo', empty: true });
    await waitFor(() => expect(index()).toBe('1 / 8'));
    expect(screen.getByTestId('slide-active').textContent).toContain('Sentetik demo verisi');
    const text = screen.getByTestId('slide-active').textContent ?? '';
    expect(text).toContain('gözlenen kullanım yok');
    expect(text).toContain('veri bir çıkarım desteklemiyor');
    expect(text).not.toMatch(/gözlendi\./);
  });

  it('has only read-only controls', async () => {
    storyApp();
    await waitFor(() => expect(index()).toBe('1 / 8'));
    for (const b of [...screen.getAllByRole('button'), ...screen.queryAllByRole('link')]) expect(`${b.textContent} ${b.getAttribute('aria-label') ?? ''}`).not.toMatch(BAD);
  });
});

describe('Costs', () => {
  it('labels the total, flags unpriced models and opens a prefilled rate editor', async () => {
    mockFetch({ '/api/v1/costs': costsDto(), '/api/v1/settings': settings });
    renderWith(<Costs />, { route: '/costs' });
    await waitFor(() => expect(screen.getAllByText(MONEY_LABEL_TR).length).toBeGreaterThan(0));
    const text = document.body.textContent ?? '';
    expect(text).toContain('$12,35');
    expect(text).toContain('Yerel geçersiz kılma');
    expect(text).toContain('Resmi');
    expect(text).toContain('Yedek fiyat');
    expect(text).toContain('Batch API discount');
    expect(text).toContain('claude-mystery-9');
    fireEvent.click(screen.getByRole('button', { name: 'Fiyat tanımla' }));
    const input = (await screen.findAllByRole('textbox')).find((i) => (i as HTMLInputElement).value === 'claude-mystery-9');
    expect(input).toBeTruthy();
    for (const b of [...screen.getAllByRole('button'), ...screen.queryAllByRole('link')]) expect(`${b.textContent} ${b.getAttribute('aria-label') ?? ''}`).not.toMatch(BAD);
  });

  it('renders English with the English label', async () => {
    mockFetch({ '/api/v1/costs': costsDto(), '/api/v1/settings': settings });
    renderWith(<Costs />, { route: '/costs', locale: 'en' });
    await waitFor(() => expect(screen.getAllByText(MONEY_LABEL_EN).length).toBeGreaterThan(0));
  });
});

describe('Rate editor validation', () => {
  const full = () => {
    const d = emptyDraft('m-1');
    d.rates = { input: '3', output: '15', cacheRead: '0.3', cacheWrite5m: '3.75', cacheWrite1h: '6' };
    return d;
  };
  it('accepts a valid draft', () => {
    const r = validateDraft(full());
    expect(r.errors).toEqual({});
    expect(r.entry?.source).toBe('user_override');
  });
  it('rejects negative and malformed rates', () => {
    const d = full();
    d.rates.input = '-1';
    d.rates.output = '';
    d.rates.cacheRead = '1.1234567';
    const { errors, entry } = validateDraft(d);
    expect(entry).toBeNull();
    expect(errors.input).toBe('decimal');
    expect(errors.output).toBe('required');
    expect(errors.cacheRead).toBe('decimal');
  });
  it('rejects effectiveTo <= effectiveFrom', () => {
    const d = full();
    d.effectiveFrom = '2026-05-01';
    d.effectiveTo = '2026-05-01';
    expect(validateDraft(d).errors.effectiveTo).toBe('range');
    d.effectiveTo = '2026-04-01';
    expect(validateDraft(d).errors.effectiveTo).toBe('range');
    d.effectiveTo = '2026-06-01';
    expect(validateDraft(d).errors).toEqual({});
  });
});

describe('Reports', () => {
  it('privacy preview lists every export column', () => {
    renderWith(<PrivacyPreview />);
    for (const c of EXPORT_COLUMNS) expect(screen.getByText(c)).toBeTruthy();
    expect(document.body.textContent).toContain('Dışa aktarılmayanlar');
  });
  it('offers real CSV/JSON downloads and a Story Mode link', async () => {
    mockFetch({ '/api/v1/reports/summary': storyDto(), '/api/v1/projects': { items: [], total: 0, nextCursor: null }, '/api/v1/overview': {} });
    renderWith(<Reports />, { route: '/reports?project=p_aaaaaaaaaaaa' });
    const csv = await screen.findByRole('link', { name: /CSV indir/ });
    expect(csv.getAttribute('href')).toMatch(/^\/api\/v1\/exports\?.*format=csv/);
    expect(csv.getAttribute('href')).toContain('projectId=p_aaaaaaaaaaaa');
    expect(csv.hasAttribute('download')).toBe(true);
    expect(screen.getByRole('link', { name: /JSON indir/ }).getAttribute('href')).toContain('format=json');
    expect(screen.getByRole('link', { name: /Story Mode'u başlat/ }).getAttribute('href')).toContain('/reports/story');
    for (const b of [...screen.getAllByRole('button'), ...screen.queryAllByRole('link')]) expect(`${b.textContent} ${b.getAttribute('aria-label') ?? ''}`).not.toMatch(BAD);
  });
});

describe('Timeline', () => {
  it('keeps the DOM bounded with 3000 intervals: one svg chart, paginated table', () => {
    const dto = timelineDto(3000, 5);
    const { container } = renderWith(<TimelineBody dto={dto} />);
    expect(container.querySelectorAll('svg.tl-svg').length).toBe(1);
    expect(container.querySelectorAll('rect.tl-iv').length).toBe(3000);
    expect(container.querySelectorAll('tbody tr').length).toBe(20);
    expect(container.querySelectorAll('button').length).toBeLessThan(40);
    expect(container.querySelectorAll('*').length).toBeLessThan(3000 + 700);
    fireEvent.click(screen.getByRole('button', { name: /Sonraki/ }));
    expect(screen.getByText('Sayfa 2 / 150')).toBeTruthy();
  });
  it('shows interval details with timezone on table focus', () => {
    const dto = timelineDto(10, 2);
    renderWith(<TimelineBody dto={dto} />);
    const btn = screen.getAllByRole('button', { name: /lane-0 aralığını seç/ })[0] as HTMLElement;
    fireEvent.focus(btn);
    const panel = screen.getByTestId('tl-active');
    expect(panel.textContent).toContain('lane-0');
    expect(panel.textContent).toMatch(/GMT\+3|TRT/);
    expect(within(panel).getByRole('link', { name: 'Oturumu aç' })).toBeTruthy();
  });
  it('renders the page with legend, truncated notice and no control buttons', async () => {
    mockFetch({ '/api/v1/timeline': { ...timelineDto(6, 2), truncated: true }, '/api/v1/overview': {} });
    renderWith(<Timeline />, { route: '/timeline' });
    await waitFor(() => expect(document.body.textContent).toContain('CPU kullanımı veya doğrulanmış çalışma süresi değildir'));
    expect(await screen.findByText(/gösterim sınırlandı/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '24 sa' })).toBeTruthy();
    for (const b of [...screen.getAllByRole('button'), ...screen.queryAllByRole('link')]) expect(`${b.textContent} ${b.getAttribute('aria-label') ?? ''}`).not.toMatch(BAD);
  });
});

describe('RateEditor save', () => {
  it('sends PATCH /settings {rateOverrides}, shows the server 400 message and blocks invalid input client-side', async () => {
    const calls: { method: string; body: string | null }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://127.0.0.1');
      if (url.pathname === '/api/v1/session') return new Response(JSON.stringify({ csrfToken: 'tok', version: 'x' }), { status: 200 });
      calls.push({ method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : null });
      return new Response(JSON.stringify({ error: { code: 'INVALID_FILTER', message: 'Invalid request: rateOverrides', retryable: false } }), { status: 400 });
    }));
    const { RateEditor } = await import('./costs/RateEditor');
    renderWith(<RateEditor entries={[]} prefillModelId="claude-x-1" onClose={() => undefined} />);
    const inputs = screen.getAllByRole('textbox');
    // submit empty rates first: client validation blocks the request
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect((await screen.findAllByText('Bu alan zorunlu.')).length).toBeGreaterThanOrEqual(5);
    expect(calls.length).toBe(0);
    const rateInputs = inputs.slice(-5) as HTMLInputElement[];
    expect(rateInputs).toHaveLength(5);
    ['-1', '15', '0.3', '3.75', '6'].forEach((v, i) => fireEvent.change(rateInputs[i] as HTMLInputElement, { target: { value: v } }));
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findAllByText(/Negatif olmayan ondalık/)).toBeTruthy();
    expect(calls.length).toBe(0);
    fireEvent.change(rateInputs[0] as HTMLInputElement, { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
    expect(await screen.findByText('Invalid request: rateOverrides')).toBeTruthy();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('PATCH');
    const sent = JSON.parse(calls[0]?.body ?? '{}') as { rateOverrides: { modelId: string; source: string; rates: { input: string } }[] };
    expect(sent.rateOverrides[0]).toMatchObject({ modelId: 'claude-x-1', source: 'user_override', rates: { input: '3' } });
  });
});
