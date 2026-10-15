import { useMemo, useState } from 'react';
import type { ProjectSummary } from '@orbit/core';
import { useFilters } from '../../api/filters';
import { useProjects } from '../../api/hooks';
import { DataTable, type Column } from '../../components/DataTable';
import { EmptyState, Query } from '../../components/states';
import { FLink, PageHeader, Trunc } from '../../components/layout';
import { MoneyValue } from '../../components/badges';
import { Sparkline } from '../../components/Sparkline';
import { TokenMixBar } from '../../components/TokenMix';
import { EntityFilters } from '../../components/Topbar';
import { useFormat, useT } from '../../i18n';

export function projectName(p: Pick<ProjectSummary, 'alias' | 'label'>) {
  return p.alias ?? p.label;
}

export function Projects() {
  const t = useT();
  const fmt = useFormat();
  const f = useFilters();
  const [q, setQ] = useState('');
  const query = useProjects({ ...f.query, projectId: undefined });
  const cols: Column<ProjectSummary>[] = useMemo(() => [
    { key: 'name', header: t('col.project'), headerLabel: t('col.project'), sortValue: (p) => projectName(p).toLowerCase(), className: 'cell-name', render: (p) => (
      <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
        <FLink to={`/projects/${encodeURIComponent(p.id)}`}><Trunc text={projectName(p)} max={240} /></FLink>
        {p.nameCollision ? <span className="badge unknown mono" title={t('project.collision')}>{p.shortCode}</span> : null}
        {!p.sourcePresent ? <span className="badge warn" title={t('project.archivedHelp')}>{t('project.archived')}</span> : null}
      </span>) },
    { key: 'sessions', header: t('col.sessions'), headerLabel: t('col.sessions'), align: 'num', sortValue: (p) => p.sessions, render: (p) => fmt.num(p.sessions) },
    { key: 'req', header: t('col.uniqueRequests'), headerLabel: t('col.uniqueRequests'), align: 'num', sortValue: (p) => p.requests, render: (p) => fmt.num(p.requests) },
    { key: 'tokens', header: t('col.tokenMix'), headerLabel: t('col.tokenMix'), sortValue: (p) => p.tokens.processed, render: (p) => <div style={{ minWidth: 120 }}><div className="small">{fmt.compact(p.tokens.processed)}</div><TokenMixBar tokens={p.tokens} /></div> },
    { key: 'usd', header: t('money.short'), headerLabel: t('money.short'), align: 'num', sortValue: (p) => Number(p.usdDecimal), render: (p) => <MoneyValue usd={p.usdDecimal} labelMode="sr" /> },
    { key: 'trend', header: t('col.trend'), render: (p) => <Sparkline values={p.trend} label={t('col.trend')} /> },
    { key: 'last', header: t('col.lastActive'), headerLabel: t('col.lastActive'), sortValue: (p) => p.lastActiveAt ?? null, render: (p) => (p.lastActiveAt ? fmt.dateTime(p.lastActiveAt) : '—') },
  ], [t, fmt]);
  return (
    <>
      <PageHeader eyebrow={t('nav.projects')} title={t('projects.title')} lead={t('projects.lead')} />
      <div className="row">
        <label className="field"><span>{t('filter.search')}</span><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('projects.searchPlaceholder')} /></label>
        <EntityFilters models />
      </div>
      <Query q={query} skeleton={300}>
        {(page) => {
          const needle = q.trim().toLowerCase();
          const rows = needle ? page.items.filter((p) => `${p.alias ?? ''} ${p.label} ${p.shortCode}`.toLowerCase().includes(needle)) : page.items;
          if (page.items.length === 0) return <EmptyState title={t('projects.empty.title')} body={t('projects.empty.body')} />;
          return (
            <>
              <DataTable caption={t('projects.title')} columns={cols} rows={rows} rowKey={(p) => p.id} defaultSort={{ key: 'tokens', dir: 'desc' }} empty={<span className="muted">{t('state.noMatch')}</span>} />
              {page.total > page.items.length ? <p className="small muted">{t('state.truncated', { shown: page.items.length, total: page.total })}</p> : null}
              <p className="small muted">{t('money.footnote')}</p>
            </>
          );
        }}
      </Query>
    </>
  );
}
