import type { AgentStatus, LinkConfidence, Quality, DatasetMode, Coverage, CostSummary } from '@orbit/core';
import { MONEY_DISCLAIMER_EN, MONEY_DISCLAIMER_TR, MONEY_LABEL_EN, MONEY_LABEL_TR } from '@orbit/core';
import { useFormat, useI18n, useT } from '../i18n';
import { Icon } from './icons';
import { InfoTip, TipBox } from './Tooltip';

const QUALITY_ICON: Record<Quality, string> = { observed: 'eye', derived: 'check', estimated: 'flat', unknown: 'info' };

export function QualityBadge({ quality, reason }: { quality: Quality; reason?: string }) {
  const t = useT();
  const name = t(`quality.${quality}`);
  return (
    <TipBox label={`${t('quality.label')}: ${name}`} className={`badge ${quality}`} body={t(`quality.${quality}.help`)} {...(reason ? { hint: t(reason) } : {})}>
      <Icon name={QUALITY_ICON[quality] ?? 'info'} size={13} />
      {name}
    </TipBox>
  );
}

export function useMoneyText() {
  const { locale } = useI18n();
  return locale === 'tr' ? { label: MONEY_LABEL_TR, disclaimer: MONEY_DISCLAIMER_TR } : { label: MONEY_LABEL_EN, disclaimer: MONEY_DISCLAIMER_EN };
}

/** Estimated API-equivalent USD. The estimate label is ALWAYS in the DOM (visible, or screen-reader-only in dense tables). */
export function MoneyValue({ usd, labelMode = 'visible', tip = true }: { usd: string | null | undefined; labelMode?: 'visible' | 'sr' | 'compact'; tip?: boolean }) {
  const fmt = useFormat();
  const t = useT();
  const { label, disclaimer } = useMoneyText();
  const has = usd !== null && usd !== undefined && usd !== '';
  if (labelMode === 'compact') {
    // The surrounding row/heading already shows the label: value + an info button whose description carries label + disclaimer.
    return (
      <span className="money-inline">
        <span className="money-v">{has ? fmt.usd(usd) : t('money.unpriced')}</span>
        <InfoTip label={label} text={`${label}. ${disclaimer}`} />
      </span>
    );
  }
  return (
    <span className={labelMode === 'visible' ? 'money' : 'money-inline'}>
      <span className="money-v">{has ? fmt.usd(usd) : t('money.unpriced')}</span>
      <span className={labelMode === 'visible' ? 'money-label' : 'sr-only'}>
        {label}
        {labelMode === 'visible' && tip ? (
          <>
            {' '}
            <InfoTip label={label} text={disclaimer} />
          </>
        ) : null}
      </span>
    </span>
  );
}

export function CoverageChip({ coverage, cost }: { coverage: Pick<Coverage, 'unpricedRequestCount'>; cost: Pick<CostSummary, 'requestCoverage'> }) {
  const t = useT();
  const fmt = useFormat();
  const pct = cost.requestCoverage;
  const full = coverage.unpricedRequestCount === 0;
  return (
    <span className={`badge ${full ? 'good' : 'warn'}`}>
      <Icon name={full ? 'check' : 'alert'} size={13} />
      {t('coverage.chip', { pct: fmt.pct(pct), count: coverage.unpricedRequestCount })}
    </span>
  );
}

export function DatasetBadge({ mode, compact = false }: { mode: DatasetMode; compact?: boolean }) {
  const t = useT();
  if (mode === 'demo')
    return (
      <span className="badge dataset-demo" role="status" {...(compact ? { 'aria-label': t('dataset.demo'), title: t('dataset.demo') } : {})}>
        <Icon name="alert" size={14} />
        {compact ? t('shell.dataset.demoShort') : t('dataset.demo')}
      </span>
    );
  if (mode === 'real')
    return (
      <span className="badge dataset-real" role="status" {...(compact ? { 'aria-label': t('dataset.real'), title: t('dataset.real') } : {})}>
        <Icon name="check" size={14} />
        {compact ? t('shell.dataset.realShort') : t('dataset.real')}
      </span>
    );
  return <span className="badge unknown">{t('dataset.none')}</span>;
}

export function ConfidenceBadge({ confidence }: { confidence: LinkConfidence }) {
  const t = useT();
  return (
    <span className={`badge ${confidence}`}>
      <Icon name={confidence === 'exact' ? 'check' : confidence === 'inferred' ? 'flat' : 'info'} size={13} />
      {t(`confidence.${confidence}`)}
    </span>
  );
}

/** Never claims liveness: only "observed recently" (with timestamp), "historical", "unknown". */
export function StatusBadge({ status, lastAt }: { status: AgentStatus; lastAt?: string | null }) {
  const t = useT();
  const fmt = useFormat();
  const key = status === 'completed_recorded' ? 'historical' : status;
  const when = key === 'observed_recently' && lastAt ? ` · ${fmt.dateTime(lastAt)}` : '';
  return (
    <span className={`badge ${key === 'observed_recently' ? 'good' : 'unknown'}`}>
      <Icon name={key === 'observed_recently' ? 'eye' : key === 'historical' ? 'session' : 'info'} size={13} />
      {t(`status.${key}`)}
      {when}
    </span>
  );
}
