import type { SessionSummary } from '@orbit/core';
import { DataTable, type Column } from '../../components/DataTable';
import { FLink, Trunc } from '../../components/layout';
import { MoneyValue } from '../../components/badges';
import { useFormat, useT } from '../../i18n';

export function SessionsTable({ sessions, showProject = true }: { sessions: SessionSummary[]; showProject?: boolean }) {
  const t = useT();
  const fmt = useFormat();
  const { label } = { label: t('money.short') };
  const cols: Column<SessionSummary>[] = [
    ...(showProject ? [{ key: 'project', header: t('col.project'), headerLabel: t('col.project'), sortValue: (s: SessionSummary) => s.projectLabel, render: (s: SessionSummary) => <FLink to={`/projects/${encodeURIComponent(s.projectId)}`}><Trunc text={s.projectLabel} max={200} /></FLink>, className: 'cell-name' }] : []),
    { key: 'id', header: t('col.session'), headerLabel: t('col.session'), sortValue: (s) => s.shortId, render: (s) => <FLink to={`/sessions/${encodeURIComponent(s.id)}`} className="mono">{s.shortId}</FLink> },
    { key: 'first', header: t('col.firstAt'), headerLabel: t('col.firstAt'), sortValue: (s) => s.firstAt ?? null, render: (s) => (s.firstAt ? fmt.dateTime(s.firstAt) : '—') },
    { key: 'last', header: t('col.lastAt'), headerLabel: t('col.lastAt'), sortValue: (s) => s.lastAt ?? null, render: (s) => (s.lastAt ? fmt.dateTime(s.lastAt) : '—') },
    { key: 'span', header: t('col.span'), headerLabel: t('col.span'), align: 'num', sortValue: (s) => s.observedSpanMs.value, render: (s) => (s.observedSpanMs.value === null ? '—' : <span title={t(`quality.${s.observedSpanMs.quality}`)}>{fmt.duration(s.observedSpanMs.value)}</span>) },
    { key: 'req', header: t('col.uniqueRequests'), headerLabel: t('col.uniqueRequests'), align: 'num', sortValue: (s) => s.requests, render: (s) => fmt.num(s.requests) },
    { key: 'models', header: t('col.models'), headerLabel: t('col.models'), render: (s) => (s.models.length ? <Trunc text={s.models.join(', ')} max={200} /> : '—') },
    { key: 'sub', header: t('col.subagents'), headerLabel: t('col.subagents'), align: 'num', sortValue: (s) => s.subagentCount, render: (s) => fmt.num(s.subagentCount) },
    { key: 'usd', header: label, headerLabel: label, align: 'num', sortValue: (s) => Number(s.usdDecimal), render: (s) => <MoneyValue usd={s.usdDecimal} labelMode="sr" /> },
  ];
  return <DataTable caption={t('nav.sessions')} columns={cols} rows={sessions} rowKey={(s) => s.id} defaultSort={{ key: 'last', dir: 'desc' }} />;
}
