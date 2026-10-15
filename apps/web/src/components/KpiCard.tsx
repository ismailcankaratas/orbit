import type { ReactNode } from 'react';
import type { Quality } from '@orbit/core';
import { useFormat, useT } from '../i18n';
import { Icon } from './icons';
import { QualityBadge } from './badges';
import { Sparkline } from './Sparkline';

/** Delta vs previous period; null/undefined => "no comparison" (previous missing or coverage differs). */
export function Delta({ current, previous }: { current: number; previous: number | null | undefined }) {
  const t = useT();
  const fmt = useFormat();
  if (previous === null || previous === undefined || previous === 0) return <span className="muted">{t('kpi.noComparison')}</span>;
  const ratio = (current - previous) / previous;
  const dir = ratio > 0.0005 ? 'up' : ratio < -0.0005 ? 'down' : 'flat';
  return (
    <span className={`delta ${dir}`}>
      <Icon name={dir} size={14} />
      {fmt.pct(Math.abs(ratio), 1)} <span className="muted">{t('kpi.vsPrevious')}</span>
    </span>
  );
}

export function KpiCard({ label, value, quality, reason, delta, spark, children, sparkLabel }: { label: string; value: ReactNode; quality?: Quality; reason?: string; delta?: ReactNode; spark?: number[]; sparkLabel?: string; children?: ReactNode }) {
  return (
    <section className="card kpi" aria-label={label}>
      <div className="label">
        <span>{label}</span>
        {quality ? <QualityBadge quality={quality} {...(reason ? { reason } : {})} /> : null}
      </div>
      <div className="value">{value}</div>
      {children}
      <div className="foot">
        <span>{delta}</span>
        {spark ? <Sparkline values={spark} {...(sparkLabel ? { label: sparkLabel } : {})} /> : null}
      </div>
    </section>
  );
}
