import { useState } from 'react';
import type { Insight, OverviewDTO } from '@orbit/core';
import { useFilters } from '../../api/filters';
import { exportUrl, useOverview } from '../../api/hooks';
import { CoveragePanel } from '../../components/CoveragePanel';
import { KpiCard, Delta } from '../../components/KpiCard';
import { DailyChartLazy, ModelDonutLazy } from '../../components/LazyCharts';
import { OrbitHero } from '../../components/OrbitHero';
import { Sparkline } from '../../components/Sparkline';
import { TokenLegend, TokenMixBar } from '../../components/TokenMix';
import { CoverageChip, MoneyValue, QualityBadge } from '../../components/badges';
import { EmptyState, Query } from '../../components/states';
import { Card, FLink, Trunc } from '../../components/layout';
import { Icon } from '../../components/icons';
import { EntityFilters } from '../../components/Topbar';
import { placeholders } from '../../i18n/translate';
import { useFormat, useT } from '../../i18n';
import type { DailyMetric } from '../../components/charts';

/** Only link to in-app routes that exist in this build. */
function safeHref(h: string): string | null {
  return /^\/(projects|sessions|agents|settings|costs|timeline|reports)(\/[\w.-]+)?$/.test(h) ? h : null;
}

function InsightCard({ insight }: { insight: Insight }) {
  const t = useT();
  const fmt = useFormat();
  const key = `insight.${insight.kind}`;
  const tpl = t(key);
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(insight.params)) {
    params[k] = k === 'sharePct' && typeof v === 'number' ? fmt.pct(v / 100, 0) : k === 'share' && typeof v === 'number' ? fmt.pct(v <= 1 ? v : v / 100, 0) : k === 'date' && typeof v === 'string' ? fmt.day(v, true) : v;
  }
  const complete = tpl !== key && placeholders(tpl).every((p) => p in params);
  const text = complete
    ? t(key, params)
    : `${t('insight.generic')}: ${Object.entries(insight.params).map(([k, v]) => `${k}=${String(v)}`).join(', ')}`;
  const href = safeHref(insight.evidenceHref);
  return (
    <li className="card raised">
      <div className="eyebrow">{t('insight.eyebrow')}</div>
      <p style={{ fontFamily: 'var(--font-serif)', fontSize: 19, margin: '6px 0 10px' }} className="wrap-safe">{text}</p>
      {href ? <FLink to={href} className="btn sm">{t('insight.evidence')} <Icon name="chevR" size={14} /></FLink> : null}
    </li>
  );
}

function AgentLanes({ lanes }: { lanes: OverviewDTO['agentLanes'] }) {
  const t = useT();
  const fmt = useFormat();
  if (!lanes.length) return <EmptyState title={t('lanes.empty')} />;
  const max = Math.max(1, ...lanes.flatMap((l) => l.hourly));
  return (
    <div className="lanes">
      {lanes.map((l, i) => {
        const name = l.role ?? t('agent.roleUnknown');
        const peak = l.hourly.indexOf(Math.max(...l.hourly));
        return (
          <div key={`${l.role ?? 'null'}-${i}`} className="lane">
            <div><Trunc text={name} max={150} /><div className="small muted">{t('lanes.invocations', { count: l.invocations })}</div></div>
            <div className="heat" role="img" aria-label={`${name}: ${t('lanes.invocations', { count: l.invocations })}, ${t('lanes.peak', { hour: String(peak).padStart(2, '0') + ':00' })}`}>
              {l.hourly.map((v, h) => <i key={h} style={{ opacity: v === 0 ? 0.08 : 0.25 + 0.75 * (v / max) }} title={`${String(h).padStart(2, '0')}:00 · ${fmt.num(v)}`} />)}
            </div>
          </div>
        );
      })}
      <div className="heat-scale" aria-hidden="true"><span /><span className="ticks"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></span></div>
      <details className="alt">
        <summary>{t('chart.showTable')}</summary>
        <div className="table-scroll" role="region" aria-label={t('chart.showTable')} tabIndex={0}>
          <table className="data">
            <caption className="sr-only">{t('card.lanes')}</caption>
            <thead><tr><th scope="col">{t('col.role')}</th><th scope="col" className="num">{t('col.invocations')}</th><th scope="col">{t('lanes.peakLabel')}</th></tr></thead>
            <tbody>{lanes.map((l, i) => <tr key={i}><th scope="row">{l.role ?? t('agent.roleUnknown')}</th><td className="num">{fmt.num(l.invocations)}</td><td>{String(l.hourly.indexOf(Math.max(...l.hourly))).padStart(2, '0')}:00</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function Body({ d }: { d: OverviewDTO }) {
  const t = useT();
  const fmt = useFormat();
  const f = useFilters();
  const [metric, setMetric] = useState<DailyMetric>('tokens');
  const { kpis, previous, daily } = d;
  const empty = kpis.uniqueRequests.value === 0;
  const sameCov = previous !== null && Math.abs(previous.requestCoverage - kpis.cost.requestCoverage) < 0.005;
  const prev = sameCov ? previous : null;
  const maxTokens = Math.max(1, ...d.topProjects.map((p) => p.tokens.processed));
  const sentence = empty
    ? t('hero.empty')
    : t('hero.sentence', { requests: t('count.requests', { count: kpis.uniqueRequests.value }), sessions: t('count.sessions', { count: kpis.sessions.value }), projects: t('count.projects', { count: kpis.projects.value }), from: fmt.day(f.from, true), to: fmt.day(f.to, true) });
  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="stack">
          <div className="eyebrow">{t('nav.overview')}</div>
          <h1 id="hero-title">{t('hero.title')}</h1>
          <p className="lead" aria-live="polite">{sentence}</p>
          <div className="row">
            <a className="btn primary" href={exportUrl(f.query, 'csv')} download><Icon name="download" size={16} />{t('action.downloadSummary')}</a>
            <FLink to="/reports" className="btn"><Icon name="report" size={16} />{t('action.openReport')}</FLink>
            <span className="small muted">{t('export.note')}</span>
          </div>
        </div>
        <div className="hero-art"><OrbitHero projects={kpis.projects.value} sessions={kpis.sessions.value} agents={kpis.subagents.value} /></div>
      </section>

      <EntityFilters models />

      {empty ? <EmptyState title={t('overview.empty.title')} body={t('overview.empty.body')} /> : null}

      <div className="grid kpis">
        <KpiCard label={t('kpi.tokens')} quality={kpis.tokens.quality} value={fmt.compact(kpis.tokens.processed)} delta={<Delta current={kpis.tokens.processed} previous={prev?.processedTokens} />} spark={daily.map((x) => x.tokens.processed)} sparkLabel={t('kpi.tokens')}>
          <TokenMixBar tokens={kpis.tokens} />
          <TokenLegend tokens={kpis.tokens} />
        </KpiCard>
        <KpiCard label={t('kpi.requests')} quality={kpis.uniqueRequests.quality} {...(kpis.uniqueRequests.reason ? { reason: kpis.uniqueRequests.reason } : {})} value={fmt.num(kpis.uniqueRequests.value)} delta={<Delta current={kpis.uniqueRequests.value} previous={prev?.uniqueRequests} />} spark={daily.map((x) => x.uniqueRequests)}>
          <span className="small muted">{t('kpi.requests.help')}</span>
        </KpiCard>
        <KpiCard label={t('kpi.value')} quality="estimated" reason="reason.estimatedValue" value={<MoneyValue usd={kpis.cost.usdDecimal} />} delta={<Delta current={Number(kpis.cost.usdDecimal)} previous={prev ? Number(prev.usdDecimal) : null} />} spark={daily.map((x) => Number(x.usdDecimal))} />
        <KpiCard label={t('kpi.sessions')} quality={kpis.sessions.quality} value={fmt.num(kpis.sessions.value)} delta={<Delta current={kpis.sessions.value} previous={prev?.sessions} />} spark={daily.map((x) => x.sessions)} />
        <KpiCard label={t('kpi.subagents')} quality={kpis.subagents.quality} value={fmt.num(kpis.subagents.value)}><FLink to="/agents" className="small">{t('action.viewAgents')}</FLink></KpiCard>
        <KpiCard label={t('kpi.coverage')} quality="derived" value={fmt.pct(kpis.cost.requestCoverage)}><CoverageChip coverage={d.coverage} cost={kpis.cost} /></KpiCard>
      </div>

      <div className="grid two">
        <Card title={t('card.daily')} aside={
          <div className="seg" role="group" aria-label={t('chart.metric')}>
            {(['tokens', 'value', 'requests'] as const).map((m) => <button key={m} type="button" aria-pressed={metric === m} onClick={() => setMetric(m)}>{t(`chart.metric.${m}`)}</button>)}
          </div>}>
          {metric === 'value' ? <p className="small muted" style={{ marginTop: -6 }}>{t('chart.valueNote')}</p> : null}
          <DailyChartLazy daily={daily} metric={metric} />
        </Card>
        <Card title={t('card.models')}>
          {d.models.length ? <ModelDonutLazy models={d.models} /> : <EmptyState title={t('state.noData')} />}
        </Card>
      </div>

      <div className="grid two">
        <Card title={t('card.topProjects')} aside={<FLink to="/projects" className="small">{t('action.allProjects')}</FLink>}>
          {d.topProjects.length === 0 ? <EmptyState title={t('state.noData')} /> : (
            <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
              {d.topProjects.map((p, i) => (
                <li key={p.id} className="bar-row">
                  <span className="muted">{i + 1}</span>
                  <span style={{ minWidth: 0 }}><FLink to={`/projects/${encodeURIComponent(p.id)}`}><Trunc text={p.alias ?? p.label} max={220} /></FLink>{p.nameCollision ? <span className="badge unknown" style={{ marginLeft: 6 }}>{p.shortCode}</span> : null}</span>
                  <span className="bar-track" aria-hidden="true"><i style={{ width: `${(p.tokens.processed / maxTokens) * 100}%` }} /></span>
                  <span className="nowrap">{fmt.compact(p.tokens.processed)}</span>
                  <span className="spark"><Sparkline values={p.trend} label={t('col.trend')} /></span>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card title={t('card.lanes')}><p className="small muted" style={{ marginTop: -6 }}>{t('lanes.note')}</p><AgentLanes lanes={d.agentLanes} /></Card>
      </div>

      <div className="grid two">
        <Card title={t('card.insights')}>
          {d.insights.length ? <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>{d.insights.map((i) => <InsightCard key={i.id} insight={i} />)}</ul> : <EmptyState title={t('insight.none')} />}
        </Card>
        <Card title={t('card.coverage')} aside={<QualityBadge quality="derived" />}><CoveragePanel coverage={d.coverage} cost={kpis.cost} /></Card>
      </div>
      <p className="small muted">{t('money.footnote')}</p>
    </>
  );
}

export function Overview() {
  const f = useFilters();
  const q = useOverview(f.query);
  return <Query q={q} skeleton={420}>{(d) => <Body d={d} />}</Query>;
}
