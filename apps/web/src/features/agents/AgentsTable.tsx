import type { AgentSummary } from '@orbit/core';
import { DataTable, type Column } from '../../components/DataTable';
import { FLink, Trunc } from '../../components/layout';
import { ConfidenceBadge, MoneyValue, StatusBadge } from '../../components/badges';
import { useFormat, useT } from '../../i18n';

export function roleName(role: string | null, t: (k: string) => string) {
  return role ?? t('agent.roleUnknown');
}

export function AgentsTable({ agents, onSelect, showProject = false }: { agents: AgentSummary[]; onSelect?: (id: string) => void; showProject?: boolean }) {
  const t = useT();
  const fmt = useFormat();
  const cols: Column<AgentSummary>[] = [
    { key: 'role', header: t('col.role'), headerLabel: t('col.role'), sortValue: (a) => a.role ?? '', className: 'cell-name', render: (a) => {
      const name = roleName(a.role, t);
      return onSelect
        ? <button type="button" className="th-btn" style={{ color: 'var(--accent)' }} onClick={() => onSelect(a.id)} aria-label={t('agent.inspect', { name, id: a.shortId })}><Trunc text={name} max={200} /> <span className="mono muted">{a.shortId}</span></button>
        : <FLink to="/agents" extra={{ agent: a.id }}><Trunc text={name} max={200} /> <span className="mono muted">{a.shortId}</span></FLink>;
    } },
    ...(showProject ? [{ key: 'project', header: t('col.project'), headerLabel: t('col.project'), sortValue: (a: AgentSummary) => a.projectLabel ?? '', render: (a: AgentSummary) => (a.projectId && a.projectLabel ? <FLink to={`/projects/${encodeURIComponent(a.projectId)}`}><Trunc text={a.projectLabel} max={180} /></FLink> : '—') }] : []),
    { key: 'session', header: t('col.parentSession'), render: (a) => (a.sessionId ? <FLink to={`/sessions/${encodeURIComponent(a.sessionId)}`} className="mono">{a.sessionId.slice(0, 8)}</FLink> : '—') },
    { key: 'conf', header: t('col.confidence'), headerLabel: t('col.confidence'), sortValue: (a) => a.confidence, render: (a) => <ConfidenceBadge confidence={a.confidence} /> },
    { key: 'status', header: t('col.status'), headerLabel: t('col.status'), sortValue: (a) => a.status, render: (a) => <StatusBadge status={a.status} lastAt={a.lastAt} /> },
    { key: 'req', header: t('col.uniqueRequests'), headerLabel: t('col.uniqueRequests'), align: 'num', sortValue: (a) => a.requests, render: (a) => fmt.num(a.requests) },
    { key: 'models', header: t('col.models'), render: (a) => (a.models.length ? <Trunc text={a.models.join(', ')} max={180} /> : '—') },
    { key: 'usd', header: t('money.short'), headerLabel: t('money.short'), align: 'num', sortValue: (a) => Number(a.usdDecimal), render: (a) => <MoneyValue usd={a.usdDecimal} labelMode="sr" /> },
    { key: 'last', header: t('col.lastEvent'), headerLabel: t('col.lastEvent'), sortValue: (a) => a.lastAt ?? null, render: (a) => (a.lastAt ? fmt.dateTime(a.lastAt) : '—') },
  ];
  return <DataTable caption={t('nav.agents')} columns={cols} rows={agents} rowKey={(a) => a.id} defaultSort={{ key: 'last', dir: 'desc' }} />;
}
