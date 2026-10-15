import { useParams } from 'react-router-dom';
import type { AgentSummary, SessionDetailDTO } from '@orbit/core';
import { useFilters } from '../../api/filters';
import { useSession } from '../../api/hooks';
import { CoveragePanel } from '../../components/CoveragePanel';
import { ModelDonutLazy, RequestsAreaChartLazy } from '../../components/LazyCharts';
import { TokenLegend, TokenMixBar } from '../../components/TokenMix';
import { ConfidenceBadge, MoneyValue, QualityBadge, StatusBadge } from '../../components/badges';
import { Query } from '../../components/states';
import { Card, FLink, PageHeader, Trunc } from '../../components/layout';
import { Icon } from '../../components/icons';
import { roleName } from '../agents/AgentsTable';
import { useFormat, useT } from '../../i18n';

function AgentTree({ agents }: { agents: AgentSummary[] }) {
  const t = useT();
  const fmt = useFormat();
  const ids = new Set(agents.map((a) => a.id));
  const kids = new Map<string | null, AgentSummary[]>();
  for (const a of agents) {
    const parent = a.parentAgentId && ids.has(a.parentAgentId) ? a.parentAgentId : null;
    kids.set(parent, [...(kids.get(parent) ?? []), a]);
  }
  const render = (parent: string | null, depth: number): React.ReactNode => {
    const list = kids.get(parent);
    if (!list || depth > 8) return null;
    return (
      <ul style={{ listStyle: 'none', margin: 0, paddingLeft: depth ? 20 : 0, borderLeft: depth ? '1px dashed var(--line-strong)' : 'none' }} className="stack">
        {list.map((a) => (
          <li key={a.id}>
            <div className="row" style={{ gap: 8 }}>
              <FLink to="/agents" extra={{ agent: a.id }}><Trunc text={roleName(a.role, t)} max={220} /> <span className="mono muted">{a.shortId}</span></FLink>
              <ConfidenceBadge confidence={a.confidence} />
              <StatusBadge status={a.status} lastAt={a.lastAt} />
              <span className="small muted">{t('count.requests', { count: a.requests })} · {fmt.compact(a.tokens.processed)}</span>
            </div>
            {render(a.id, depth + 1)}
          </li>
        ))}
      </ul>
    );
  };
  return <>{render(null, 0)}</>;
}

function Body({ d }: { d: SessionDetailDTO }) {
  const t = useT();
  const fmt = useFormat();
  const s = d.session;
  const points = d.requests.map((r) => ({ t: new Date(r.t).getTime(), processed: r.processed, kind: r.kind }));
  const total = d.attribution.main.processed + d.attribution.agents.processed;
  return (
    <>
      <PageHeader crumbs={[{ to: '/sessions', label: t('nav.sessions') }, { label: s.shortId }]} eyebrow={t('session.eyebrow')} title={<span className="mono">{s.shortId}</span>} />
      <div className="row">
        <FLink to={`/projects/${encodeURIComponent(s.projectId)}`} className="badge"><Icon name="folder" size={13} /><Trunc text={s.projectLabel} max={240} /></FLink>
        <span className={`badge ${s.sourcePresent ? 'good' : 'warn'}`}>{s.sourcePresent ? t('project.sourcePresent') : t('project.archived')}</span>
        {s.firstAt && s.lastAt ? <span className="small muted">{fmt.dateTime(s.firstAt)} → {fmt.dateTime(s.lastAt)}</span> : null}
        {s.observedSpanMs.value !== null ? <span className="small muted">{t('col.span')}: {fmt.duration(s.observedSpanMs.value)} <QualityBadge quality={s.observedSpanMs.quality} /></span> : null}
      </div>
      <div className="grid halves">
        <Card title={t('card.sessionSummary')}>
          <dl className="kv">
            <dt>{t('col.uniqueRequests')}</dt><dd>{fmt.num(s.requests)}</dd>
            <dt>{t('tokens.processed')}</dt><dd>{fmt.compact(s.tokens.processed)}</dd>
            <dt>{t('money.short')}</dt><dd><MoneyValue usd={s.usdDecimal} labelMode="compact" /></dd>
            <dt>{t('col.subagents')}</dt><dd>{fmt.num(s.subagentCount)}</dd>
            <dt>{t('col.models')}</dt><dd className="wrap-safe">{s.models.join(', ') || '—'}</dd>
            <dt>{t('session.taskTitle')}</dt><dd className="muted">{t('session.taskHidden')}</dd>
          </dl>
          <TokenMixBar tokens={s.tokens} /><TokenLegend tokens={s.tokens} />
        </Card>
        <Card title={t('card.attribution')} aside={<QualityBadge quality="derived" />}>
          <div className="mixbar" role="img" aria-label={`${t('attr.main')} ${fmt.pct(d.attribution.main.processed / (total || 1))}, ${t('attr.agents')} ${fmt.pct(d.attribution.agents.processed / (total || 1))}`}>
            <i style={{ width: `${(d.attribution.main.processed / (total || 1)) * 100}%`, background: 'var(--accent)' }} />
            <i style={{ width: `${(d.attribution.agents.processed / (total || 1)) * 100}%`, background: 'var(--violet)' }} />
          </div>
          <dl className="kv" style={{ marginTop: 10 }}>
            <dt>{t('attr.main')}</dt><dd>{fmt.compact(d.attribution.main.processed)} · {t('count.requests', { count: d.attribution.main.requests })}</dd>
            <dt>{t('attr.agents')}</dt><dd>{fmt.compact(d.attribution.agents.processed)} · {t('count.requests', { count: d.attribution.agents.requests })}</dd>
          </dl>
        </Card>
      </div>
      <Card title={t('card.usageOverTime')} aside={<span className="small muted">{t('session.requestPoints', { count: d.requests.length })}</span>}>
        {points.length === 0 ? <p className="muted">{t('state.noData')}</p> : (
          <>
            <RequestsAreaChartLazy points={points} />
            {d.truncated ? <p className="small muted">{t('session.truncated')}</p> : null}
            <details className="alt">
              <summary>{t('chart.showTable')}</summary>
              <div className="table-scroll" role="region" aria-label={t('chart.showTable')} tabIndex={0}>
                <table className="data">
                  <caption className="sr-only">{t('card.usageOverTime')}</caption>
                  <thead><tr><th scope="col">{t('col.time')}</th><th scope="col">{t('col.kind')}</th><th scope="col">{t('col.model')}</th><th scope="col" className="num">{t('tokens.processed')}</th><th scope="col" className="num">{t('tokens.output')}</th></tr></thead>
                  <tbody>{d.requests.slice(0, 200).map((r, i) => <tr key={i}><td>{fmt.dateTime(r.t)}</td><td>{t(`attr.kind.${r.kind}`)}</td><td className="wrap-safe">{r.model ?? '—'}</td><td className="num">{fmt.num(r.processed)}</td><td className="num">{fmt.num(r.output)}</td></tr>)}</tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </Card>
      <div className="grid halves">
        <Card title={t('card.agentTree')}>{d.agents.length ? <AgentTree agents={d.agents} /> : <p className="muted">{t('session.noAgents')}</p>}</Card>
        <Card title={t('card.models')}>{d.models.length ? <ModelDonutLazy models={d.models} /> : <p className="muted">{t('state.noData')}</p>}</Card>
      </div>
      <Card title={t('card.coverage')}><CoveragePanel coverage={d.coverage} /></Card>
    </>
  );
}

export function SessionDetail() {
  const { id = '' } = useParams();
  const f = useFilters();
  const q = useSession(id, { ...f.query, projectId: undefined });
  return <Query q={q} skeleton={400}>{(d) => <Body d={d} />}</Query>;
}
