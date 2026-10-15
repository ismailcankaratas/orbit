/**
 * Orbit Ask executor. Answers are computed ONLY from the local API (/api/v1/overview, /api/v1/projects)
 * or run an injected action. No numbers are invented: anything not derivable is reported as such.
 */
import type { OverviewDTO, Page, ProjectSummary } from '@orbit/core';
import { ApiRequestError, type Query } from '../api/client';
import { addDays, dayStartIso, todayIn } from '../api/dates';
import { exportUrl } from '../api/hooks';
import { CHAPTERS, foldText } from '../experience/chapters';
import type { AskAnswer, AskIntent, AskQuestion, AskRange } from '../experience/contracts';
import type { Formatters } from '../i18n/format';
import type { TFn } from '../i18n';

export interface AskActions {
  goToChapter: (slug: string) => void;
  openCatalog: (filter?: string) => void;
  openHelp: () => void;
  openSettings: () => void;
  openExplorer: (path: string) => void;
  /** Trigger a real browser download of a same-origin URL. */
  download: (url: string) => void;
  /** POST /scan */
  rescan: () => Promise<unknown>;
  /** PATCH /settings {activeDataset} */
  setDataset: (mode: 'real' | 'demo') => Promise<unknown>;
  /** PATCH /settings {locale} + i18n setLocale */
  setLanguage: (locale: 'tr' | 'en') => Promise<unknown>;
}

export interface AskDeps {
  now: Date;
  tz: string;
  t: TFn;
  fmt: Formatters;
  /** Global filters as API query (from/to/tz/projectId/modelId). */
  query: Query;
  /** Global filter params as a search string (leading ?) for evidence links. */
  search: string;
  get: <T>(path: string, query?: Query) => Promise<T>;
  actions: AskActions;
}

const V = '/api/v1';

/** A very wide window used to look projects up independent of the selected range. */
export function wideQuery(tz: string, now: Date): Query {
  const today = todayIn(tz, now.getTime());
  return { from: dayStartIso(addDays(today, -1825), tz), to: dayStartIso(addDays(today, 1), tz), tz };
}

function evidence(path: string, deps: AskDeps, range?: AskRange): string {
  if (!range) return `${path}${deps.search}`;
  const lastInstant = Date.parse(range.to) - 1;
  const p = new URLSearchParams({ from: todayIn(deps.tz, Date.parse(range.from)), to: todayIn(deps.tz, lastInstant) });
  return `${path}?${p.toString()}`;
}

const answer = (a: AskAnswer): AskAnswer => a;

function errorAnswer(e: unknown): AskAnswer {
  const code = e instanceof ApiRequestError ? e.code : 'INTERNAL';
  return { status: 'error', messageKey: `error.${code}.body`, params: {} };
}

async function actionError(e: unknown): Promise<AskAnswer> {
  if (e instanceof ApiRequestError && (e.code === 'CONSENT_REQUIRED' || e.code === 'RATE_LIMITED')) {
    return { status: 'error', messageKey: `ask.error.${e.code}` };
  }
  return errorAnswer(e);
}

async function runCommand(intent: Extract<AskIntent, { kind: 'command' }>, deps: AskDeps): Promise<AskAnswer> {
  const { actions, t } = deps;
  switch (intent.command) {
    case 'chapters':
      actions.openCatalog();
      return { status: 'action_done', messageKey: 'ask.action.chapters' };
    case 'help':
      actions.openHelp();
      return { status: 'action_done', messageKey: 'ask.action.help' };
    case 'settings':
      actions.openSettings();
      return { status: 'action_done', messageKey: 'ask.action.settings' };
    case 'go': {
      const ch = CHAPTERS.find((c) => c.slug === intent.arg);
      if (!ch) return { status: 'unsupported', messageKey: 'ask.answer.unsupported' };
      const title = t(ch.titleKey);
      if (ch.status !== 'ready') return { status: 'unsupported', messageKey: 'ask.answer.chapterPlanned', params: { title } };
      actions.goToChapter(ch.slug);
      return { status: 'action_done', messageKey: 'ask.action.go', params: { title } };
    }
    case 'explorer': {
      if (!intent.arg) return { status: 'unsupported', messageKey: 'ask.answer.unsupported' };
      actions.openExplorer(intent.arg);
      return { status: 'action_done', messageKey: 'ask.action.explorer' };
    }
    case 'export_csv':
    case 'export_json': {
      const format = intent.command === 'export_csv' ? 'csv' : 'json';
      actions.download(exportUrl(deps.query, format));
      return { status: 'action_done', messageKey: 'ask.action.export', params: { format: format.toUpperCase() }, moneyCaveat: true };
    }
    case 'rescan':
      try {
        await actions.rescan();
        return { status: 'action_done', messageKey: 'ask.action.rescan' };
      } catch (e) {
        return actionError(e);
      }
    case 'demo':
    case 'real':
      try {
        await actions.setDataset(intent.command);
        return { status: 'action_done', messageKey: intent.command === 'demo' ? 'ask.action.demo' : 'ask.action.real' };
      } catch (e) {
        return actionError(e);
      }
    case 'language': {
      const l = intent.arg === 'en' ? 'en' : 'tr';
      try {
        await actions.setLanguage(l);
        return { status: 'action_done', messageKey: 'ask.action.language', params: { lang: l === 'tr' ? 'Türkçe' : 'English' } };
      } catch (e) {
        return actionError(e);
      }
    }
  }
}

function coverageSentence(o: OverviewDTO, deps: AskDeps): string {
  const { t, fmt } = deps;
  const c = o.kpis.cost;
  if (c.unpricedRequestCount === 0) return t('ask.coverage.full', { pct: fmt.pct(c.requestCoverage, 1) });
  const models = c.unpricedModels.slice(0, 3).join(', ');
  return t('ask.coverage.partial', { count: c.unpricedRequestCount, pct: fmt.pct(c.requestCoverage, 1), models: models || '—' });
}

async function runQuestion(intent: Extract<AskIntent, { kind: 'question' }>, deps: AskDeps): Promise<AskAnswer> {
  const { t, fmt } = deps;
  const range = intent.range;
  const q: AskQuestion = intent.question;
  const period = range ? t(range.labelKey, range.params) : t('ask.period.selected');
  const base: Query = range ? { ...deps.query, from: range.from, to: range.to } : { ...deps.query };
  const noData = (extra?: Partial<AskAnswer>): AskAnswer => ({ status: 'no_data', messageKey: 'ask.answer.noData', params: { period }, evidenceHref: evidence('/bolum/merkez', deps, range), ...extra });

  try {
    let projectId: string | undefined;
    let project: ProjectSummary | undefined;
    if (q === 'project_summary') {
      const page = await deps.get<Page<ProjectSummary>>(`${V}/projects`, { ...wideQuery(deps.tz, deps.now), sort: 'tokens', limit: 200 });
      const want = foldText(intent.projectQuery ?? '');
      project = page.items.find((p) => foldText(p.alias ?? '') === want || foldText(p.label) === want);
      if (!project) return { status: 'no_data', messageKey: 'ask.answer.projectNotFound', params: { project: intent.projectQuery ?? '' } };
      projectId = project.id;
    }

    if (q === 'top_project') {
      const page = await deps.get<Page<ProjectSummary>>(`${V}/projects`, { ...base, sort: 'tokens', limit: 1 });
      const top = page.items[0];
      if (!top || top.tokens.processed === 0) return noData();
      const name = top.alias ?? top.label;
      return answer({
        status: 'answered',
        messageKey: 'ask.answer.top_project',
        params: { period, project: name, tokens: fmt.num(top.tokens.processed), sessions: top.sessions },
        figure: name,
        quality: 'observed',
        evidenceHref: evidence(`/projects/${top.id}`, deps, range),
      });
    }

    const o = await deps.get<OverviewDTO>(`${V}/overview`, projectId ? { ...base, projectId } : base);
    const k = o.kpis;
    const processed = k.tokens.processed;
    if (k.uniqueRequests.value === 0) return noData();
    const merkez = evidence('/bolum/merkez', deps, range);

    switch (q) {
      case 'total_tokens':
        return { status: 'answered', messageKey: 'ask.answer.total_tokens', params: { period, tokens: fmt.num(processed) }, figure: fmt.compact(processed), quality: 'observed', evidenceHref: merkez };
      case 'unique_requests':
        return { status: 'answered', messageKey: 'ask.answer.unique_requests', params: { period, count: k.uniqueRequests.value }, figure: fmt.num(k.uniqueRequests.value), quality: 'observed', evidenceHref: merkez };
      case 'sessions':
        return { status: 'answered', messageKey: 'ask.answer.sessions', params: { period, count: k.sessions.value }, figure: fmt.num(k.sessions.value), quality: 'observed', evidenceHref: evidence('/sessions', deps, range) };
      case 'subagents':
        return { status: 'answered', messageKey: 'ask.answer.subagents', params: { period, count: k.subagents.value }, figure: fmt.num(k.subagents.value), quality: 'observed', evidenceHref: evidence('/agents', deps, range) };
      case 'estimated_value':
        return {
          status: 'answered',
          messageKey: 'ask.answer.estimated_value',
          params: { period, value: fmt.usd(k.cost.usdDecimal), coverage: coverageSentence(o, deps) },
          figure: fmt.usd(k.cost.usdDecimal),
          quality: 'estimated',
          moneyCaveat: true,
          evidenceHref: evidence('/costs', deps, range),
        };
      case 'cache_share': {
        if (processed === 0) return noData();
        const share = k.tokens.cacheRead / processed;
        return { status: 'answered', messageKey: 'ask.answer.cache_share', params: { period, pct: fmt.pct(share, 1), tokens: fmt.num(k.tokens.cacheRead) }, figure: fmt.pct(share, 1), quality: 'derived', evidenceHref: evidence('/costs', deps, range) };
      }
      case 'top_model': {
        let top: OverviewDTO['models'][number] | undefined;
        for (const m of o.models) if (!top || m.tokens.processed > top.tokens.processed) top = m;
        if (!top) return noData();
        const name = top.displayName ?? top.modelId;
        return {
          status: 'answered',
          messageKey: top.priced ? 'ask.answer.top_model' : 'ask.answer.top_model_unpriced',
          params: { period, model: name, tokens: fmt.num(top.tokens.processed) },
          figure: name,
          quality: 'observed',
          evidenceHref: evidence('/costs', deps, range),
        };
      }
      case 'price_coverage': {
        const c = k.cost;
        const unpriced = o.coverage.unpricedRequestCount;
        return {
          status: 'answered',
          messageKey: unpriced === 0 ? 'ask.answer.price_coverage_full' : 'ask.answer.price_coverage',
          params: { period, pct: fmt.pct(c.requestCoverage, 1), count: unpriced, models: c.unpricedModels.slice(0, 3).join(', ') || '—' },
          figure: fmt.pct(c.requestCoverage, 1),
          quality: 'derived',
          evidenceHref: evidence('/costs', deps, range),
        };
      }
      case 'busiest_day': {
        let best: OverviewDTO['daily'][number] | undefined;
        for (const d of o.daily) if (!best || d.uniqueRequests > best.uniqueRequests) best = d;
        if (!best || best.uniqueRequests === 0) return noData();
        return { status: 'answered', messageKey: 'ask.answer.busiest_day', params: { period, date: fmt.day(best.date, true), count: best.uniqueRequests }, figure: fmt.day(best.date, true), quality: 'derived', evidenceHref: evidence('/timeline', deps, range) };
      }
      case 'delegation_share': {
        // The server emits the insight only when subagent requests > 0, so absence means exactly 0 observed.
        const ins = o.insights.find((i) => i.kind === 'delegation_share');
        const agentReq = ins ? Number(ins.params.agentRequests) : 0;
        if (ins && !Number.isFinite(agentReq)) return { status: 'unsupported', messageKey: 'ask.answer.delegationUnknown', evidenceHref: evidence('/agents', deps, range) };
        const share = agentReq / k.uniqueRequests.value;
        return {
          status: 'answered',
          messageKey: agentReq === 0 ? 'ask.answer.delegation_none' : 'ask.answer.delegation_share',
          params: { period, pct: fmt.pct(share, 1), agentRequests: agentReq, requests: k.uniqueRequests.value },
          figure: fmt.pct(share, 1),
          quality: 'derived',
          evidenceHref: evidence('/agents', deps, range),
        };
      }
      case 'project_summary': {
        const name = project ? (project.alias ?? project.label) : '';
        return {
          status: 'answered',
          messageKey: 'ask.answer.project_summary',
          params: { period, project: name, tokens: fmt.num(processed), sessions: k.sessions.value, requests: k.uniqueRequests.value, value: fmt.usd(k.cost.usdDecimal) },
          figure: fmt.compact(processed),
          quality: 'observed',
          moneyCaveat: true,
          evidenceHref: evidence(`/projects/${projectId}`, deps, range),
        };
      }
      default:
        return { status: 'unsupported', messageKey: 'ask.answer.unsupported' };
    }
  } catch (e) {
    return errorAnswer(e);
  }
}

export async function executeAsk(intent: AskIntent, deps: AskDeps): Promise<AskAnswer> {
  switch (intent.kind) {
    case 'command':
      return runCommand(intent, deps);
    case 'catalog':
      deps.actions.openCatalog(intent.filter);
      return { status: 'action_done', messageKey: 'ask.action.chapters' };
    case 'question':
      return runQuestion(intent, deps);
    case 'unknown':
      return { status: 'unsupported', messageKey: 'ask.answer.unsupported' };
  }
}
