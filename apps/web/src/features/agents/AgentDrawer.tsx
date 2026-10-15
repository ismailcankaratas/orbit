import type { AgentSummary } from '@orbit/core';
import { useFilters } from '../../api/filters';
import { useAgent } from '../../api/hooks';
import { Drawer } from '../../components/Overlay';
import { TokenLegend, TokenMixBar } from '../../components/TokenMix';
import { ConfidenceBadge, MoneyValue, StatusBadge } from '../../components/badges';
import { ErrorState, Skeleton } from '../../components/states';
import { FLink } from '../../components/layout';
import { Icon } from '../../components/icons';
import { useFormat, useT } from '../../i18n';
import { roleName } from './AgentsTable';

export function AgentDrawer({ summary, id, onClose }: { summary: AgentSummary | undefined; id: string; onClose: () => void }) {
  const t = useT();
  const fmt = useFormat();
  const f = useFilters();
  const q = useAgent(id, { ...f.query, projectId: undefined });
  const a = q.data?.agent ?? summary;
  const reasonKey = a ? `linkReason.${a.linkReason}` : '';
  const reasonText = a ? (t(reasonKey) !== reasonKey ? t(reasonKey) : t('linkReason.generic')) : '';
  return (
    <Drawer title={a ? `${roleName(a.role, t)} · ${a.shortId}` : t('agent.detail')} onClose={onClose}>
      {!a && q.isPending ? <Skeleton height={200} /> : null}
      {!a && q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : null}
      {a ? (
        <>
          <div className="row"><ConfidenceBadge confidence={a.confidence} /><StatusBadge status={a.status} lastAt={a.lastAt} /></div>
          <dl className="kv">
            <dt>{t('col.role')}</dt><dd className="wrap-safe">{roleName(a.role, t)}</dd>
            <dt>{t('col.models')}</dt><dd className="wrap-safe">{a.models.join(', ') || '—'}</dd>
            <dt>{t('col.project')}</dt><dd className="wrap-safe">{a.projectLabel ?? '—'}</dd>
            <dt>{t('col.uniqueRequests')}</dt><dd>{fmt.num(a.requests)}</dd>
            <dt>{t('money.short')}</dt><dd><MoneyValue usd={a.usdDecimal} labelMode="compact" /></dd>
            <dt>{t('col.lastEvent')}</dt><dd>{a.lastAt ? fmt.dateTime(a.lastAt) : '—'}</dd>
            <dt>{t('agent.firstEvent')}</dt><dd>{a.firstAt ? fmt.dateTime(a.firstAt) : '—'}</dd>
          </dl>
          <div><h3>{t('agent.usage')}</h3><TokenMixBar tokens={a.tokens} /><TokenLegend tokens={a.tokens} /></div>
          <div className="notice"><Icon name="info" size={16} /><div><strong>{t('agent.linkReason')}</strong><br />{reasonText}{reasonText === t('linkReason.generic') ? <> <code>{a.linkReason}</code></> : null}{q.data ? <><br /><span className="muted">{q.data.evidence.toolUseIdMatched ? t('agent.toolMatched') : t('agent.toolNotMatched')}</span></> : null}</div></div>
          {a.status === 'observed_recently' ? <p className="small muted">{t('agent.observedNote')}</p> : null}
          {a.sessionId ? <FLink to={`/sessions/${encodeURIComponent(a.sessionId)}`} className="btn primary"><Icon name="session" size={16} />{t('agent.viewSession')}</FLink> : <p className="small muted">{t('agent.noParent')}</p>}
          {q.data && q.data.children.length ? <p className="small muted">{t('agent.children', { count: q.data.children.length })}</p> : null}
        </>
      ) : null}
    </Drawer>
  );
}
