import type { Coverage, CostSummary } from '@orbit/core';
import { useFormat, useT } from '../i18n';
import { CoverageChip } from './badges';
import { Icon } from './icons';

export function CoveragePanel({ coverage, cost }: { coverage: Coverage; cost?: CostSummary }) {
  const t = useT();
  const fmt = useFormat();
  const warn: string[] = [];
  if (coverage.sourceStatus !== 'complete') warn.push(t(`coverage.status.${coverage.sourceStatus}`));
  if (coverage.unpricedRequestCount > 0) warn.push(t('coverage.unpriced', { count: coverage.unpricedRequestCount }));
  if (coverage.unlinkedAgentCount > 0) warn.push(t('coverage.unlinked', { count: coverage.unlinkedAgentCount }));
  if (coverage.malformedLineCount > 0) warn.push(t('coverage.malformed', { count: coverage.malformedLineCount }));
  if (coverage.archivedOnlyRequestCount > 0) warn.push(t('coverage.archivedOnly', { count: coverage.archivedOnlyRequestCount }));
  if (coverage.fallbackPricedRequestCount > 0) warn.push(t('coverage.fallback', { count: coverage.fallbackPricedRequestCount }));
  return (
    <div className="stack">
      <div className="row">{cost ? <CoverageChip coverage={coverage} cost={cost} /> : null}<span className="badge unknown">{t(`coverage.status.${coverage.sourceStatus}`)}</span></div>
      <dl className="kv">
        <dt>{t('coverage.window')}</dt>
        <dd>{coverage.sourceFirstAt && coverage.sourceLastAt ? `${fmt.date(coverage.sourceFirstAt)} – ${fmt.date(coverage.sourceLastAt)}` : t('coverage.noWindow')}</dd>
        <dt>{t('kpi.requests')}</dt><dd>{fmt.num(coverage.uniqueRequests)}</dd>
        {cost ? (<><dt>{t('coverage.rateVersion')}</dt><dd className="mono">{cost.rateScheduleVersion}</dd><dt>{t('coverage.tokenCoverage')}</dt><dd>{fmt.pct(cost.tokenCoverage, 1)}</dd></>) : null}
        {cost && cost.unpricedModels.length > 0 ? (<><dt>{t('coverage.excludedModels')}</dt><dd className="wrap-safe">{cost.unpricedModels.join(', ')}</dd></>) : null}
      </dl>
      {warn.length ? (
        <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {warn.map((w) => <li key={w} className="notice warn"><Icon name="alert" size={16} /><span>{w}</span></li>)}
        </ul>
      ) : <p className="notice good"><Icon name="check" size={16} />{t('coverage.allGood')}</p>}
      <p className="small muted">{t('coverage.note')}</p>
    </div>
  );
}
