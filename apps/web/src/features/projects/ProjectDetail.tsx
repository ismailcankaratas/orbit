import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import type { ProjectDetailDTO, TokenTotals } from '@orbit/core';
import { useFilters } from '../../api/filters';
import { useProject, useSetAlias } from '../../api/hooks';
import { CoveragePanel } from '../../components/CoveragePanel';
import { DailyChartLazy, ModelDonutLazy } from '../../components/LazyCharts';
import { TokenLegend, TokenMixBar } from '../../components/TokenMix';
import { CoverageChip, MoneyValue, QualityBadge } from '../../components/badges';
import { ErrorState, Query } from '../../components/states';
import { Card, PageHeader, Tabs } from '../../components/layout';
import { Icon } from '../../components/icons';
import { AgentsTable } from '../agents/AgentsTable';
import { SessionsTable } from '../sessions/SessionsTable';
import { useFormat, useT } from '../../i18n';
import { projectName } from './Projects';
import type { DailyMetric } from '../../components/charts';

const ALIAS_MAX = 60;

function AliasEditor({ id, current }: { id: string; current: string | null }) {
  const t = useT();
  const [val, setVal] = useState(current ?? '');
  const [err, setErr] = useState<string | null>(null);
  const m = useSetAlias(id);
  const validate = (v: string): string | null => {
    const s = v.trim();
    if (!s) return t('alias.empty');
    if (s.length > ALIAS_MAX) return t('alias.tooLong', { max: ALIAS_MAX });
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u001f\u007f<>]/.test(s)) return t('alias.badChars');
    return null;
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = validate(val);
    setErr(v);
    if (!v) m.mutate(val.trim());
  };
  return (
    <form onSubmit={submit} className="stack" aria-label={t('alias.title')}>
      <label className="field">
        <span>{t('alias.title')}</span>
        <input className="input" value={val} maxLength={ALIAS_MAX + 20} onChange={(e) => { setVal(e.target.value); setErr(null); }} aria-invalid={!!err} aria-describedby="alias-help" />
      </label>
      <p id="alias-help" className="small muted">{t('alias.help')}</p>
      {err ? <p role="alert" className="small" style={{ color: 'var(--danger)' }}>{err}</p> : null}
      {m.isError ? <ErrorState error={m.error} /> : null}
      {m.isSuccess && !m.isPending ? <p role="status" className="small" style={{ color: 'var(--green)' }}>{t('alias.saved')}</p> : null}
      <div className="row">
        <button type="submit" className="btn primary sm" disabled={m.isPending}>{t('action.save')}</button>
        {current ? <button type="button" className="btn sm" disabled={m.isPending} onClick={() => { setVal(''); setErr(null); m.mutate(null); }}>{t('alias.remove')}</button> : null}
      </div>
    </form>
  );
}

function Attribution({ a }: { a: ProjectDetailDTO['attribution'] }) {
  const t = useT();
  const fmt = useFormat();
  const rows: [string, TokenTotals & { usdDecimal: string; requests: number }][] = [[t('attr.main'), a.main], [t('attr.agents'), a.agents]];
  const total = a.main.processed + a.agents.processed || 1;
  return (
    <div className="stack">
      <div className="mixbar" role="img" aria-label={`${t('attr.main')} ${fmt.pct(a.main.processed / total)}, ${t('attr.agents')} ${fmt.pct(a.agents.processed / total)}`}>
        <i style={{ width: `${(a.main.processed / total) * 100}%`, background: 'var(--accent)' }} />
        <i style={{ width: `${(a.agents.processed / total) * 100}%`, background: 'var(--violet)' }} />
      </div>
      <dl className="kv">
        {rows.map(([name, r]) => (
          <div key={name} style={{ display: 'contents' }}>
            <dt>{name}</dt>
            <dd>{fmt.compact(r.processed)} · {t('count.requests', { count: r.requests })} · <MoneyValue usd={r.usdDecimal} labelMode="sr" /> <span className="muted">({fmt.pct(r.processed / total)})</span></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Body({ d }: { d: ProjectDetailDTO }) {
  const t = useT();
  const fmt = useFormat();
  const f = useFilters();
  const [tab, setTab] = useState('overview');
  const [metric, setMetric] = useState<DailyMetric>('tokens');
  const p = d.project;
  const unlinked = d.coverage.unlinkedAgentCount > 0 || d.agents.some((a) => a.confidence === 'unlinked');
  const cacheTotal = d.daily.reduce((a, x) => a + x.tokens.cacheRead + x.tokens.cacheWrite5m + x.tokens.cacheWrite1h + x.tokens.unsplitCacheWrite, 0);
  const cost = { requestCoverage: d.coverage.uniqueRequests ? 1 - d.coverage.unpricedRequestCount / d.coverage.uniqueRequests : 1 };
  return (
    <>
      <PageHeader crumbs={[{ to: '/projects', label: t('nav.projects') }, { label: projectName(p) }]} eyebrow={t('project.eyebrow')} title={projectName(p)}
        lead={p.alias ? <>{t('project.originalLabel')}: <span className="wrap-safe">{p.label}</span></> : undefined} />
      <div className="row">
        <span className="badge unknown mono" title={t('project.shortCode')}>#{p.shortCode}</span>
        <span className={`badge ${p.sourcePresent ? 'good' : 'warn'}`}><Icon name={p.sourcePresent ? 'check' : 'alert'} size={13} />{p.sourcePresent ? t('project.sourcePresent') : t('project.archived')}</span>
        <CoverageChip coverage={d.coverage} cost={cost} />
        <span className="small muted">{fmt.day(f.from, true)} – {fmt.day(f.to, true)} · {f.tz}</span>
      </div>
      {unlinked ? <div className="notice warn" role="note"><Icon name="alert" size={18} /><span>{t('project.unlinkedWarning', { count: d.coverage.unlinkedAgentCount })}</span></div> : null}
      {d.coverage.sourceStatus !== 'complete' ? <div className="notice warn" role="note"><Icon name="alert" size={18} /><span>{t(`coverage.status.${d.coverage.sourceStatus}`)}</span></div> : null}

      <Tabs label={t('project.tabs')} value={tab} onChange={setTab} tabs={[{ id: 'overview', label: t('tab.overview') }, { id: 'sessions', label: t('tab.sessions') }, { id: 'agents', label: t('tab.agents') }, { id: 'models', label: t('tab.models') }]} />
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="stack" style={{ gap: 20 }}>
        {tab === 'overview' ? (
          <>
            <div className="grid halves">
              <Card title={t('card.projectSummary')}>
                <dl className="kv">
                  <dt>{t('col.sessions')}</dt><dd>{fmt.num(p.sessions)}</dd>
                  <dt>{t('kpi.requests')}</dt><dd>{fmt.num(p.requests)}</dd>
                  <dt>{t('col.agents')}</dt><dd>{fmt.num(p.agents)}</dd>
                  <dt>{t('tokens.processed')}</dt><dd>{fmt.compact(p.tokens.processed)}</dd>
                  <dt>{t('money.short')}</dt><dd><MoneyValue usd={p.usdDecimal} labelMode="compact" /></dd>
                  <dt>{t('col.lastActive')}</dt><dd>{p.lastActiveAt ? fmt.dateTime(p.lastActiveAt) : '—'}</dd>
                </dl>
              </Card>
              <Card title={t('alias.title')}><AliasEditor id={p.id} current={p.alias} /></Card>
            </div>
            <Card title={t('card.daily')} aside={<div className="seg" role="group" aria-label={t('chart.metric')}>{(['tokens', 'value', 'requests'] as const).map((m) => <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)}>{t(`chart.metric.${m}`)}</button>)}</div>}>
              <DailyChartLazy daily={d.daily} metric={metric} />
            </Card>
            <div className="grid halves">
              <Card title={t('card.cache')} aside={<QualityBadge quality="observed" />}>
                <TokenMixBar tokens={p.tokens} /><TokenLegend tokens={p.tokens} />
                <p className="small muted">{t('cache.note', { share: fmt.pct(p.tokens.processed ? p.tokens.cacheRead / p.tokens.processed : 0), total: fmt.compact(cacheTotal) })}</p>
              </Card>
              <Card title={t('card.attribution')} aside={<QualityBadge quality="derived" />}><Attribution a={d.attribution} /></Card>
            </div>
            <Card title={t('card.coverage')}><CoveragePanel coverage={d.coverage} /></Card>
          </>
        ) : null}
        {tab === 'sessions' ? <Card title={t('nav.sessions')}><SessionsTable sessions={d.sessions} showProject={false} /></Card> : null}
        {tab === 'agents' ? <Card title={t('nav.agents')}>{unlinked ? <p className="notice warn">{t('project.unlinkedWarning', { count: d.coverage.unlinkedAgentCount })}</p> : null}<AgentsTable agents={d.agents} /></Card> : null}
        {tab === 'models' ? <Card title={t('tab.models')}><ModelDonutLazy models={d.models} /><p className="small muted">{t('money.footnote')}</p></Card> : null}
      </div>
    </>
  );
}

export function ProjectDetail() {
  const { id = '' } = useParams();
  const f = useFilters();
  const q = useProject(id, { ...f.query, projectId: undefined });
  return <Query q={q} skeleton={420}>{(d) => <Body key={id} d={d} />}</Query>;
}
