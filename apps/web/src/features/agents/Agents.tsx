import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { AgentGraphNode, AgentsDTO, LinkConfidence } from '@orbit/core';
import { useFilterHref, useFilters } from '../../api/filters';
import { useAgents } from '../../api/hooks';
import { MoneyValue } from '../../components/badges';
import { EmptyState, Query } from '../../components/states';
import { Card, PageHeader } from '../../components/layout';
import { Icon } from '../../components/icons';
import { useFormat, useT } from '../../i18n';
import { AgentDrawer } from './AgentDrawer';
import { AgentGraph } from './AgentGraph';
import { AgentsTable } from './AgentsTable';

/** Phones get the list first (the graph stays available through the view switch). */
function isNarrow(): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767px)').matches;
  } catch {
    return false;
  }
}

const CONF: LinkConfidence[] = ['exact', 'inferred', 'unlinked', 'unknown'];

function Body({ d }: { d: AgentsDTO }) {
  const t = useT();
  const fmt = useFormat();
  const nav = useNavigate();
  const href = useFilterHref();
  const [sp, setSp] = useSearchParams();
  const [view, setView] = useState<'graph' | 'list'>(() => (isNarrow() ? 'list' : 'graph'));
  const [role, setRole] = useState('');
  const [conf, setConf] = useState('');
  const [proj, setProj] = useState('');
  const selected = sp.get('agent');

  const projects = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of d.items) if (a.projectId && a.projectLabel) m.set(a.projectId, a.projectLabel);
    return [...m];
  }, [d.items]);
  const items = d.items.filter((a) => (!role || (a.role ?? '') === (role === '__none' ? '' : role)) && (!conf || a.confidence === conf) && (!proj || a.projectId === proj));
  const visible = new Set(items.map((a) => a.id));
  const nodes = d.graph.nodes.filter((n) => n.kind === 'session' || visible.has(n.id));
  const edges = d.graph.edges.filter((e) => nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to));

  const open = (id: string | null) => setSp((prev) => { const n = new URLSearchParams(prev); if (id) n.set('agent', id); else n.delete('agent'); return n; });
  const onNode = (n: AgentGraphNode) => (n.kind === 'agent' ? open(n.id) : void nav(href(`/sessions/${encodeURIComponent(n.id)}`)));
  const hist = d.totals.byStatus.historical + d.totals.byStatus.completed_recorded;

  return (
    <>
      <div className="row">
        <div className="seg" role="group" aria-label={t('agents.view')}>
          <button type="button" aria-pressed={view === 'graph'} onClick={() => setView('graph')}><Icon name="graph" size={14} /> {t('agents.view.graph')}</button>
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}><Icon name="list" size={14} /> {t('agents.view.list')}</button>
        </div>
        <label className="field"><span>{t('filter.role')}</span>
          <select className="input" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">{t('filter.all')}</option>
            {d.roles.map((r) => <option key={r} value={r}>{r}</option>)}
            {d.items.some((a) => a.role === null) ? <option value="__none">{t('agent.roleUnknown')}</option> : null}
          </select>
        </label>
        <label className="field"><span>{t('filter.project')}</span>
          <select className="input" value={proj} onChange={(e) => setProj(e.target.value)}>
            <option value="">{t('filter.all')}</option>
            {projects.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <label className="field"><span>{t('filter.confidence')}</span>
          <select className="input" value={conf} onChange={(e) => setConf(e.target.value)}>
            <option value="">{t('filter.all')}</option>
            {CONF.map((c) => <option key={c} value={c}>{t(`confidence.${c}`)}</option>)}
          </select>
        </label>
      </div>
      {d.items.length === 0 ? <EmptyState title={t('agents.empty.title')} body={t('agents.empty.body')} /> : (
        <>
          {view === 'graph' ? <Card title={t('agents.topology')}><AgentGraph nodes={nodes} edges={edges} truncated={d.graph.truncated} onNode={onNode} onShowList={() => setView('list')} /></Card> : null}
          <div className="agents-layout">
          <div className="stack" style={{ gap: 20 }}>
            <Card title={t('agents.listTitle', { count: items.length })}>
              <AgentsTable agents={items} onSelect={open} showProject />
              {d.total > d.items.length ? <p className="small muted">{t('state.truncated', { shown: d.items.length, total: d.total })}</p> : null}
            </Card>
          </div>
          <aside className="stack" aria-label={t('agents.totals')}>
            <Card title={t('agents.totals')}>
              <dl className="kv">
                <dt>{t('agents.total')}</dt><dd>{fmt.num(d.total)}</dd>
                <dt>{t('tokens.processed')}</dt><dd>{fmt.compact(d.totals.tokens.processed)}</dd>
                <dt>{t('money.short')}</dt><dd><MoneyValue usd={d.totals.usdDecimal} labelMode="compact" /></dd>
              </dl>
              <h3 style={{ margin: '14px 0 6px' }}>{t('filter.confidence')}</h3>
              <dl className="kv">{CONF.map((c) => <div key={c} style={{ display: 'contents' }}><dt>{t(`confidence.${c}`)}</dt><dd>{fmt.num(d.totals.byConfidence[c] ?? 0)}</dd></div>)}</dl>
              <h3 style={{ margin: '14px 0 6px' }}>{t('col.status')}</h3>
              <dl className="kv">
                <dt>{t('status.observed_recently')}</dt><dd>{fmt.num(d.totals.byStatus.observed_recently)}</dd>
                <dt>{t('status.historical')}</dt><dd>{fmt.num(hist)}</dd>
                <dt>{t('status.unknown')}</dt><dd>{fmt.num(d.totals.byStatus.unknown)}</dd>
              </dl>
              <p className="small muted" style={{ marginTop: 12 }}>{t('agents.statusNote')}</p>
            </Card>
          </aside>
          </div>
        </>
      )}
      {selected ? <AgentDrawer id={selected} summary={d.items.find((a) => a.id === selected)} onClose={() => open(null)} /> : null}
    </>
  );
}

export function Agents() {
  const t = useT();
  const f = useFilters();
  const q = useAgents(f.query);
  return (
    <>
      <PageHeader eyebrow={t('nav.agents')} title={t('agents.title')} lead={t('agents.lead')} />
      <Query q={q} skeleton={420}>{(d) => <Body d={d} />}</Query>
    </>
  );
}
