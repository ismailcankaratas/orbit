import { describe, expect, it } from 'vitest';
import { parseAsk, type AskParseContext } from './parse';
import { CHAPTERS } from '../experience/chapters';

const NOW = new Date('2026-10-15T09:00:00Z'); // Thursday
const ctx = (over: Partial<AskParseContext> = {}): AskParseContext => ({
  now: NOW,
  tz: 'Europe/Istanbul',
  locale: 'tr',
  projectLabels: ['aurora-api', 'çağrı-api', 'demo', 'demo-app'],
  ...over,
});

const cmd = (command: string, arg?: string) => ({ kind: 'command', command, ...(arg ? { arg } : {}) });
const q = (question: string, extra: object = {}) => ({ kind: 'question', question, ...extra });

describe('parseAsk commands', () => {
  const table: [string, object][] = [
    ['/bölümler', cmd('chapters')],
    ['/bolumler', cmd('chapters')],
    ['/chapters', cmd('chapters')],
    ['/BÖLÜMLER', cmd('chapters')],
    ['  /yardım ', cmd('help')],
    ['/yardim', cmd('help')],
    ['/help', cmd('help')],
    ['/dışa-aktar csv', cmd('export_csv')],
    ['/disa-aktar csv', cmd('export_csv')],
    ['/dışa aktar json', cmd('export_json')],
    ['/export json', cmd('export_json')],
    ['/export CSV', cmd('export_csv')],
    ['/ayarlar', cmd('settings')],
    ['/settings', cmd('settings')],
    ['/tara', cmd('rescan')],
    ['/scan', cmd('rescan')],
    ['/rescan', cmd('rescan')],
    ['/demo', cmd('demo')],
    ['/gerçek', cmd('real')],
    ['/gercek', cmd('real')],
    ['/real', cmd('real')],
    ['/gezgin projeler', cmd('explorer', '/projects')],
    ['/gezgin oturumlar', cmd('explorer', '/sessions')],
    ['/gezgin ajanlar', cmd('explorer', '/agents')],
    ['/gezgin zaman', cmd('explorer', '/timeline')],
    ['/gezgin maliyetler', cmd('explorer', '/costs')],
    ['/gezgin raporlar', cmd('explorer', '/reports')],
    ['/explore costs', cmd('explorer', '/costs')],
    ['/explore reports', cmd('explorer', '/reports')],
    ['/dil en', cmd('language', 'en')],
    ['/dil tr', cmd('language', 'tr')],
    ['/language EN', cmd('language', 'en')],
    ['/merkez', cmd('go', 'merkez')],
    ['/center', cmd('go', 'merkez')],
    ['/yörüngeler', cmd('go', 'yorungeler')],
    ['/projects', cmd('go', 'yorungeler')],
    ['/oturum akışı', cmd('go', 'oturumlar')],
    ['/tahmini değer', cmd('go', 'deger')],
    ['/kapsam', cmd('go', 'kapsam')],
    ['/', { kind: 'catalog', filter: '' }],
    ['/mer', { kind: 'catalog', filter: 'mer' }],
    ['/dış', { kind: 'catalog', filter: 'dis' }],
    ['/export', { kind: 'catalog', filter: 'export' }],
    ['/gezgin', { kind: 'catalog', filter: 'gezgin' }],
    ['/dil fr', { kind: 'catalog', filter: 'dil fr' }],
  ];
  it.each(table)('%s', (input, expected) => {
    expect(parseAsk(input, ctx())).toMatchObject(expected);
  });
  it('every chapter slug resolves to go', () => {
    for (const c of CHAPTERS) expect(parseAsk(`/${c.slug}`, ctx())).toEqual({ kind: 'command', command: 'go', arg: c.slug });
  });
});

describe('parseAsk questions', () => {
  const table: [string, object][] = [
    ['kaç token işlendi', q('total_tokens')],
    ['Toplam token', q('total_tokens')],
    ['how many tokens?', q('total_tokens')],
    ['kaç benzersiz istek', q('unique_requests')],
    ['unique requests', q('unique_requests')],
    ['kaç oturum', q('sessions')],
    ['how many sessions', q('sessions')],
    ['sessions', q('sessions')],
    ['kaç alt ajan', q('subagents')],
    ['how many subagents', q('subagents')],
    ['tahmini değer ne kadar', q('estimated_value')],
    ['ne kadar harcadım', q('estimated_value')],
    ['estimated value', q('estimated_value')],
    ['cost', q('estimated_value')],
    ['önbellek oranı', q('cache_share')],
    ['cache hit', q('cache_share')],
    ['cache share', q('cache_share')],
    ['en çok kullanılan proje', q('top_project')],
    ['en aktif proje hangisi', q('top_project')],
    ['top project', q('top_project')],
    ['en çok kullanılan model', q('top_model')],
    ['top model', q('top_model')],
    ['fiyat kapsamı', q('price_coverage')],
    ['fiyatsız istek', q('price_coverage')],
    ['price coverage', q('price_coverage')],
    ['unpriced', q('price_coverage')],
    ['en yoğun gün', q('busiest_day')],
    ['busiest day', q('busiest_day')],
    ['alt ajan payı', q('delegation_share')],
    ['delegation share', q('delegation_share')],
    ['aurora-api hakkında', q('project_summary', { projectQuery: 'aurora-api' })],
    ['aurora-api projesi kaç token', q('project_summary', { projectQuery: 'aurora-api' })],
    ['about aurora-api', q('project_summary', { projectQuery: 'aurora-api' })],
    ['ÇAĞRI-API hakkında', q('project_summary', { projectQuery: 'çağrı-api' })],
    ['cagri-api projesi kaç token', q('project_summary', { projectQuery: 'çağrı-api' })],
    ["çağrı-api'nin tahmini değeri", q('project_summary', { projectQuery: 'çağrı-api' })],
    ['demo-app hakkında', q('project_summary', { projectQuery: 'demo-app' })],
    ['demo hakkında', q('project_summary', { projectQuery: 'demo' })],
    ['bilinmeyen-proje hakkında', { kind: 'unknown' }],
    ['', { kind: 'unknown' }],
    ['bana bir şiir yaz', { kind: 'unknown' }],
    ['what is the weather', { kind: 'unknown' }],
  ];
  it.each(table)('%s', (input, expected) => {
    expect(parseAsk(input, ctx())).toMatchObject(expected);
  });
  it('project mention does not leak into the time parser', () => {
    const r = parseAsk('mart-app hakkında', ctx({ projectLabels: ['mart-app'] }));
    expect(r).toEqual({ kind: 'question', question: 'project_summary', projectQuery: 'mart-app' });
  });
});

describe('parseAsk time phrases (Europe/Istanbul, now=Thu 2026-10-15)', () => {
  const r = (s: string, over?: Partial<AskParseContext>) => {
    const i = parseAsk(s, ctx(over));
    return i.kind === 'question' ? i.range : undefined;
  };
  it('bugün / today', () => {
    for (const s of ['bugün kaç oturum', 'sessions today']) {
      expect(r(s)).toMatchObject({ from: '2026-10-14T21:00:00.000Z', to: '2026-10-15T21:00:00.000Z' });
    }
  });
  it('dün / yesterday', () => {
    expect(r('dün kaç token')).toMatchObject({ from: '2026-10-13T21:00:00.000Z', to: '2026-10-14T21:00:00.000Z', labelKey: 'ask.range.yesterday' });
    expect(r('tokens yesterday')).toMatchObject({ labelKey: 'ask.range.yesterday' });
  });
  it('bu hafta starts Monday and is clamped to tomorrow', () => {
    expect(r('bu hafta kaç oturum')).toMatchObject({ from: '2026-10-11T21:00:00.000Z', to: '2026-10-15T21:00:00.000Z', labelKey: 'ask.range.thisWeek' });
    expect(r('sessions this week')).toMatchObject({ labelKey: 'ask.range.thisWeek' });
  });
  it('geçen hafta / last week = previous Monday..Monday', () => {
    const want = { from: '2026-10-04T21:00:00.000Z', to: '2026-10-11T21:00:00.000Z' };
    expect(r('geçen hafta kaç token')).toMatchObject(want);
    expect(r('tokens last week')).toMatchObject(want);
  });
  it('son N gün / last N days include today', () => {
    expect(r('son 7 gün kaç oturum')).toMatchObject({ from: '2026-10-08T21:00:00.000Z', to: '2026-10-15T21:00:00.000Z', labelKey: 'ask.range.lastDays', params: { count: 7 } });
    expect(r('how many sessions in the last 30 days')).toMatchObject({ params: { count: 30 } });
    expect(r('son 365 gün token')).toMatchObject({ params: { count: 365 } });
  });
  it('out-of-range N is ignored (no range)', () => {
    expect(r('son 0 gün token')).toBeUndefined();
    expect(r('last 400 days tokens')).toBeUndefined();
  });
  it('bu ay / geçen ay', () => {
    expect(r('bu ay token')).toMatchObject({ from: '2026-09-30T21:00:00.000Z', to: '2026-10-15T21:00:00.000Z' });
    expect(r('last month tokens')).toMatchObject({ from: '2026-08-31T21:00:00.000Z', to: '2026-09-30T21:00:00.000Z' });
    expect(r('geçen ay kaç oturum')).toMatchObject({ labelKey: 'ask.range.lastMonth' });
  });
  it('month names (tr + en), current year or previous when in the future', () => {
    expect(r('eylül kaç oturum')).toMatchObject({ from: '2026-08-31T21:00:00.000Z', to: '2026-09-30T21:00:00.000Z', labelKey: 'ask.range.month.9', params: { year: 2026 } });
    expect(r('sessions in september')).toMatchObject({ labelKey: 'ask.range.month.9' });
    expect(r('aralık ayında kaç token')).toMatchObject({ from: '2025-11-30T21:00:00.000Z', to: '2025-12-31T21:00:00.000Z', params: { year: 2025 } });
    expect(r('tokens in december')).toMatchObject({ params: { year: 2025 } });
    expect(r('ocakta kaç oturum')).toMatchObject({ params: { year: 2026 } });
    expect(r('mart 2024 token')).toMatchObject({ params: { year: 2024 } });
  });
  it('time phrase does not hide the question type', () => {
    expect(parseAsk('geçen hafta en yoğun gün', ctx())).toMatchObject({ question: 'busiest_day', range: { labelKey: 'ask.range.lastWeek' } });
    expect(parseAsk('bugün tahmini değer', ctx())).toMatchObject({ question: 'estimated_value' });
  });
  it('project + time phrase', () => {
    expect(parseAsk('aurora-api son 7 gün kaç token', ctx())).toMatchObject({ question: 'project_summary', projectQuery: 'aurora-api', range: { params: { count: 7 } } });
  });
  it('no time phrase -> no range (global filters apply)', () => {
    expect(r('kaç oturum')).toBeUndefined();
  });
});

describe('parseAsk DST-safe ranges', () => {
  const ny = (s: string, now: string) => {
    const i = parseAsk(s, ctx({ tz: 'America/New_York', now: new Date(now) }));
    return i.kind === 'question' ? i.range : undefined;
  };
  it('last week across the US fall-back (Nov 1 2026) spans 7 days + 1 hour', () => {
    const rg = ny('last week sessions', '2026-11-04T15:00:00Z'); // Wed
    expect(rg).toMatchObject({ from: '2026-10-26T04:00:00.000Z', to: '2026-11-02T05:00:00.000Z' });
  });
  it('this week after fall-back starts at 05:00Z (EST)', () => {
    expect(ny('this week tokens', '2026-11-04T15:00:00Z')).toMatchObject({ from: '2026-11-02T05:00:00.000Z', to: '2026-11-05T05:00:00.000Z' });
  });
  it('march across spring-forward (Mar 8 2026)', () => {
    expect(ny('tokens in march', '2026-10-15T15:00:00Z')).toMatchObject({ from: '2026-03-01T05:00:00.000Z', to: '2026-04-01T04:00:00.000Z' });
  });
  it('today uses the local day, not UTC', () => {
    // 02:00Z on Oct 15 is still Oct 14 in New York
    expect(ny('sessions today', '2026-10-15T02:00:00Z')).toMatchObject({ from: '2026-10-14T04:00:00.000Z', to: '2026-10-15T04:00:00.000Z' });
  });
  it('Istanbul has no DST: stable +03:00 midnight', () => {
    const i = parseAsk('bugün kaç oturum', ctx({ now: new Date('2026-03-29T00:30:00Z') }));
    expect(i).toMatchObject({ range: { from: '2026-03-28T21:00:00.000Z', to: '2026-03-29T21:00:00.000Z' } });
  });
});
