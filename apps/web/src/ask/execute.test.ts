import { describe, expect, it, vi } from 'vitest';
import type { OverviewDTO, ProjectSummary } from '@orbit/core';
import { executeAsk, type AskDeps } from './execute';
import { parseAsk } from './parse';
import { makeFormatters } from '../i18n/format';
import { translate } from '../i18n/translate';
import { coverage, cost, tokens } from '../test/dto';
import { ApiRequestError } from '../api/client';
import type { LocaleId } from '../i18n/registry';

const project = (over: Partial<ProjectSummary> = {}): ProjectSummary => ({
  id: 'p_aaaaaaaaaaaa', alias: null, label: 'aurora-api', shortCode: 'ab12', nameCollision: false, sessions: 5, requests: 70, agents: 2,
  tokens: { ...tokens, processed: 7000 }, usdDecimal: '8.000000', unpricedRequests: 0, lastActiveAt: '2026-10-14T10:00:00Z', trend: [1], sourcePresent: true, ...over,
});

const day = (date: string, n: number) => ({ date, uniqueRequests: n, tokens: tokens, usdDecimal: '1.000000', unpricedRequests: 0, sessions: 1 });

function overview(over: Partial<OverviewDTO> = {}): OverviewDTO {
  return {
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
    daily: [day('2026-10-12', 10), day('2026-10-13', 40), day('2026-10-14', 12)],
    models: [
      { modelId: 'claude-mystery-9', displayName: null, requests: 20, tokens: { ...tokens, processed: 9000 }, usdDecimal: null, priced: false },
      { modelId: 'claude-sonnet-5', displayName: 'Claude Sonnet 5', requests: 80, tokens: { ...tokens, processed: 1000 }, usdDecimal: '10.000000', priced: true },
    ],
    topProjects: [project()],
    agentLanes: [],
    insights: [{ id: 'delegation_share', kind: 'delegation_share', params: { sharePct: 30, agentRequests: 30 }, evidenceHref: '/agents' }],
    coverage,
    ...over,
  };
}

function setup(locale: LocaleId = 'tr', ov: OverviewDTO = overview(), projects: ProjectSummary[] = [project()]) {
  const calls: { path: string; query: Record<string, unknown> | undefined }[] = [];
  const actions = {
    goToChapter: vi.fn(),
    openCatalog: vi.fn(),
    openHelp: vi.fn(),
    openSettings: vi.fn(),
    openExplorer: vi.fn(),
    download: vi.fn(),
    rescan: vi.fn(async () => undefined),
    setDataset: vi.fn(async () => undefined),
    setLanguage: vi.fn(async () => undefined),
  };
  const deps: AskDeps = {
    now: new Date('2026-10-15T09:00:00Z'),
    tz: 'Europe/Istanbul',
    t: (k, p) => translate(locale, k, p),
    fmt: makeFormatters(locale, 'Europe/Istanbul'),
    query: { from: '2026-09-15T21:00:00.000Z', to: '2026-10-15T21:00:00.000Z', tz: 'Europe/Istanbul' },
    search: '?range=30',
    get: (async (path: string, query?: Record<string, unknown>) => {
      calls.push({ path, query });
      if (path === '/api/v1/overview') return ov;
      if (path === '/api/v1/projects') return { items: projects, total: projects.length, nextCursor: null };
      throw new Error('unexpected ' + path);
    }) as AskDeps['get'],
    actions,
  };
  const ask = (text: string, labels = ['aurora-api']) => executeAsk(parseAsk(text, { now: deps.now, tz: deps.tz, locale, projectLabels: labels }), deps);
  const say = (a: Awaited<ReturnType<typeof ask>>) => deps.t(a.messageKey, a.params);
  return { deps, actions, calls, ask, say };
}

describe('executeAsk questions (numbers from the OverviewDTO fixture)', () => {
  it('total tokens = kpis.tokens.processed', async () => {
    const { ask, say } = setup();
    const a = await ask('kaç token işlendi');
    expect(a.status).toBe('answered');
    expect(a.quality).toBe('observed');
    expect(say(a)).toContain('10.000');
    expect(a.evidenceHref).toBe('/bolum/merkez?range=30');
  });
  it('unique requests, sessions, subagents', async () => {
    const { ask, say } = setup();
    expect(say(await ask('kaç benzersiz istek'))).toContain('100');
    const s = await ask('kaç oturum');
    expect(s.figure).toBe('7');
    expect(s.evidenceHref).toBe('/sessions?range=30');
    expect((await ask('kaç alt ajan')).figure).toBe('3');
  });
  it('cache share = cacheRead / processed', async () => {
    const { ask } = setup();
    const a = await ask('önbellek oranı');
    expect(a.figure).toBe('%80');
    expect(a.quality).toBe('derived');
  });
  it('top project queries /projects (sorted by tokens) and links to the project', async () => {
    const { ask, calls } = setup();
    const a = await ask('en çok kullanılan proje');
    expect(a.figure).toBe('aurora-api');
    expect(a.evidenceHref).toBe('/projects/p_aaaaaaaaaaaa?range=30');
    const c = calls.find((x) => x.path === '/api/v1/projects');
    expect(c?.query).toMatchObject({ sort: 'tokens', limit: 1, tz: 'Europe/Istanbul' });
  });
  it('top model by tokens marks unpriced models', async () => {
    const { ask, say } = setup();
    const a = await ask('en çok kullanılan model');
    expect(a.messageKey).toBe('ask.answer.top_model_unpriced');
    expect(say(a)).toContain('claude-mystery-9');
  });
  it('price coverage reports the unpriced count', async () => {
    const { ask, say } = setup();
    const a = await ask('fiyat kapsamı');
    expect(a.figure).toBe('%90');
    expect(say(a)).toContain('10');
    expect(say(a)).toContain('claude-mystery-9');
  });
  it('busiest day = max daily.uniqueRequests', async () => {
    const { ask, say } = setup('en');
    const a = await ask('busiest day');
    expect(say(a)).toContain('40');
    expect(a.evidenceHref).toBe('/timeline?range=30');
  });
  it('delegation share is exact from observed agent requests', async () => {
    const { ask, say } = setup();
    const a = await ask('alt ajan payı');
    expect(a.figure).toBe('%30');
    expect(say(a)).toContain('30 / 100');
  });
  it('delegation share with no subagent insight says none observed', async () => {
    const { ask } = setup('tr', overview({ insights: [] }));
    expect((await ask('alt ajan payı')).messageKey).toBe('ask.answer.delegation_none');
  });
  it('project summary resolves the id then queries overview with projectId', async () => {
    const { ask, calls, say } = setup();
    const a = await ask('aurora-api hakkında');
    expect(a.status).toBe('answered');
    expect(a.moneyCaveat).toBe(true);
    expect(a.evidenceHref).toBe('/projects/p_aaaaaaaaaaaa?range=30');
    expect(calls.find((c) => c.path === '/api/v1/overview')?.query).toMatchObject({ projectId: 'p_aaaaaaaaaaaa' });
    expect(say(a)).toContain('aurora-api');
  });
  it('unknown project name -> no_data, no overview call', async () => {
    const { ask, calls } = setup('tr', overview(), []);
    const a = await ask('aurora-api hakkında');
    expect(a.status).toBe('no_data');
    expect(calls.some((c) => c.path === '/api/v1/overview')).toBe(false);
  });
});

describe('executeAsk time phrases', () => {
  it('uses the phrase range for the query and as evidence params', async () => {
    const { ask, calls } = setup();
    const a = await ask('son 7 gün kaç oturum');
    expect(calls[0]?.query).toMatchObject({ from: '2026-10-08T21:00:00.000Z', to: '2026-10-15T21:00:00.000Z', tz: 'Europe/Istanbul' });
    expect(a.evidenceHref).toBe('/sessions?from=2026-10-09&to=2026-10-15');
  });
  it('without a phrase it passes the global filters unchanged', async () => {
    const { ask, calls } = setup();
    await ask('kaç oturum');
    expect(calls[0]?.query).toMatchObject({ from: '2026-09-15T21:00:00.000Z', to: '2026-10-15T21:00:00.000Z' });
  });
});

describe('estimated value wording', () => {
  for (const locale of ['tr', 'en'] as const) {
    it(`carries the caveat and never says spent/harcama (${locale})`, async () => {
      const { ask, say } = setup(locale);
      for (const text of locale === 'tr' ? ['tahmini değer ne kadar', 'ne kadar harcadım'] : ['estimated value', 'cost']) {
        const a = await ask(text);
        expect(a.status).toBe('answered');
        expect(a.moneyCaveat).toBe(true);
        expect(a.quality).toBe('estimated');
        const sentence = say(a);
        expect(sentence).not.toMatch(/harca|spent|spend/i);
        expect(sentence.toLowerCase()).toContain(locale === 'tr' ? 'tahmini api eşdeğeri değer' : 'estimated api-equivalent value');
        expect(sentence).toContain('$12.35'.replace('.', locale === 'tr' ? ',' : '.'));
        // coverage sentence mentions the 10 unpriced requests and the model
        expect(sentence).toContain('10');
        expect(sentence).toContain('claude-mystery-9');
      }
    });
  }
});

describe('empty / unsupported / errors', () => {
  const empty = overview({
    kpis: { ...overview().kpis, uniqueRequests: { value: 0, quality: 'observed' }, tokens: { ...tokens, processed: 0, quality: 'observed' } },
    daily: [],
    models: [],
  });
  it('empty period -> no_data for every metric question', async () => {
    const { ask } = setup('tr', empty, []);
    for (const text of ['kaç token işlendi', 'tahmini değer', 'önbellek oranı', 'en yoğun gün', 'kaç oturum']) {
      expect((await ask(text)).status).toBe('no_data');
    }
  });
  it('unknown text -> unsupported with no API calls', async () => {
    const { ask, calls } = setup();
    const a = await ask('bana bir şiir yaz');
    expect(a.status).toBe('unsupported');
    expect(a.messageKey).toBe('ask.answer.unsupported');
    expect(calls).toHaveLength(0);
  });
  it('API failure -> error answer with an i18n key', async () => {
    const { ask, deps, say } = setup();
    deps.get = (async () => {
      throw new ApiRequestError('NETWORK', 'network', true, 0);
    }) as AskDeps['get'];
    const a = await ask('kaç oturum');
    expect(a.status).toBe('error');
    expect(say(a)).toContain('Orbit sunucusunun');
  });
});

describe('executeAsk commands', () => {
  it('planned chapter answers "not ready" and does NOT navigate', async () => {
    const { ask, actions, say } = setup();
    const a = await ask('/yörüngeler');
    expect(a.status).toBe('unsupported');
    expect(a.messageKey).toBe('ask.answer.chapterPlanned');
    expect(say(a)).toContain('henüz hazır değil');
    expect(actions.goToChapter).not.toHaveBeenCalled();
  });
  it('ready chapter navigates', async () => {
    const { ask, actions } = setup();
    expect((await ask('/merkez')).status).toBe('action_done');
    expect(actions.goToChapter).toHaveBeenCalledWith('merkez');
  });
  it('overlay commands call their actions', async () => {
    const { ask, actions } = setup();
    await ask('/bölümler');
    await ask('/yardım');
    await ask('/ayarlar');
    await ask('/gezgin projeler');
    await ask('/m');
    expect(actions.openCatalog).toHaveBeenCalledTimes(2);
    expect(actions.openCatalog).toHaveBeenLastCalledWith('m');
    expect(actions.openHelp).toHaveBeenCalled();
    expect(actions.openSettings).toHaveBeenCalled();
    expect(actions.openExplorer).toHaveBeenCalledWith('/projects');
  });
  it('export triggers a real download of exportUrl(filters, format)', async () => {
    const { ask, actions } = setup();
    const a = await ask('/dışa-aktar json');
    const url = actions.download.mock.calls[0]?.[0] as string;
    expect(url.startsWith('/api/v1/exports?')).toBe(true);
    expect(url).toContain('format=json');
    expect(url).toContain('tz=Europe%2FIstanbul');
    expect(a.moneyCaveat).toBe(true);
  });
  it('rescan maps CONSENT_REQUIRED and RATE_LIMITED', async () => {
    const { ask, actions, say } = setup();
    actions.rescan.mockRejectedValueOnce(new ApiRequestError('CONSENT_REQUIRED', 'x', false, 403));
    const a = await ask('/tara');
    expect(a.status).toBe('error');
    expect(a.messageKey).toBe('ask.error.CONSENT_REQUIRED');
    actions.rescan.mockRejectedValueOnce(new ApiRequestError('RATE_LIMITED', 'x', true, 429));
    expect((await ask('/scan')).messageKey).toBe('ask.error.RATE_LIMITED');
    expect(say(a)).toContain('izni');
    expect((await ask('/tara')).status).toBe('action_done');
  });
  it('demo / real / language call their actions', async () => {
    const { ask, actions } = setup();
    await ask('/demo');
    await ask('/gerçek');
    await ask('/dil en');
    expect(actions.setDataset).toHaveBeenNthCalledWith(1, 'demo');
    expect(actions.setDataset).toHaveBeenNthCalledWith(2, 'real');
    expect(actions.setLanguage).toHaveBeenCalledWith('en');
  });
});
