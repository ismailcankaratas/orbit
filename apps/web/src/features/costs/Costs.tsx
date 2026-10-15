import { useState } from 'react';
import type { CostsDTO, RateEntry } from '@orbit/core';
import { MISSING_MODEL_ID } from './rates';
import { useFilters } from '../../api/filters';
import { useCosts, useSettings } from '../../api/hooks';
import { CoverageChip, MoneyValue, QualityBadge, useMoneyText } from '../../components/badges';
import { DataTable, type Column } from '../../components/DataTable';
import { DailyChartLazy } from '../../components/LazyCharts';
import { Icon } from '../../components/icons';
import { Card, PageHeader } from '../../components/layout';
import { EmptyState, Query } from '../../components/states';
import { EntityFilters } from '../../components/Topbar';
import { TOKEN_KEYS } from '../../components/TokenMix';
import { useFormat, useT } from '../../i18n';
import { RateEditor } from './RateEditor';

type ModelRow = CostsDTO['byModel'][number];

export function SourceBadge({ source }: { source: 'official' | 'user_override' | null }) {
  const t = useT();
  if (source === 'user_override') return <span className="badge warn local-badge"><Icon name="alert" size={13} />{t('rates.source.local')}</span>;
  if (source === 'official') return <span className="badge good"><Icon name="check" size={13} />{t('rates.source.official')}</span>;
  return <span className="badge unknown">{t('rates.source.none')}</span>;
}

function CategoryTable({ d }: { d: CostsDTO }) {
  const t = useT();
  const fmt = useFormat();
  const { label } = useMoneyText();
  const rows = TOKEN_KEYS.filter((k) => d.byCategory[k].tokens > 0 || k !== 'unsplitCacheWrite');
  return (
    <div className="table-scroll" role="region" aria-label={t('costs.byCategory')} tabIndex={0}>
      <table className="data">
        <caption className="sr-only">{t('costs.byCategory')}</caption>
        <thead><tr><th scope="col">{t('costs.category')}</th><th scope="col" className="num">{t('tokens.processed')}</th><th scope="col" className="num">{label}</th></tr></thead>
        <tbody>
          {rows.map((k) => (
            <tr key={k}>
              <th scope="row">
                <span className="swatch" style={{ background: `var(--c-${k})` }} aria-hidden="true" />
                {t(`tokens.${k}`)}
                {k === 'unsplitCacheWrite' ? <div className="small muted">{t('costs.unsplitNote')}</div> : null}
              </th>
              <td className="num">{fmt.num(d.byCategory[k].tokens)}</td>
              <td className="num"><MoneyValue usd={d.byCategory[k].usdDecimal} labelMode="sr" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelTable({ rows }: { rows: ModelRow[] }) {
  const t = useT();
  const fmt = useFormat();
  const rate = (r: ModelRow, k: 'input' | 'output' | 'cacheRead' | 'cacheWrite5m' | 'cacheWrite1h') => (r.rate ? r.rate[k] : '—');
  const cols: Column<ModelRow>[] = [
    { key: 'model', header: t('col.model'), headerLabel: t('col.model'), sortValue: (r) => r.displayName ?? r.modelId, className: 'cell-name', render: (r) => <><div className="wrap-safe">{r.displayName ?? r.modelId}</div>{r.displayName ? <div className="mono small muted wrap-safe">{r.modelId}</div> : null}</> },
    { key: 'req', header: t('col.requests'), headerLabel: t('col.requests'), align: 'num', sortValue: (r) => r.requests, render: (r) => fmt.num(r.requests) },
    { key: 'tok', header: t('tokens.processed'), headerLabel: t('tokens.processed'), align: 'num', sortValue: (r) => r.tokens.processed, render: (r) => fmt.num(r.tokens.processed) },
    { key: 'in', header: t('tokens.uncachedInput'), align: 'num', render: (r) => rate(r, 'input') },
    { key: 'out', header: t('tokens.output'), align: 'num', render: (r) => rate(r, 'output') },
    { key: 'cr', header: t('tokens.cacheRead'), align: 'num', render: (r) => rate(r, 'cacheRead') },
    { key: 'c5', header: t('tokens.cacheWrite5m'), align: 'num', render: (r) => rate(r, 'cacheWrite5m') },
    { key: 'c1', header: t('tokens.cacheWrite1h'), align: 'num', render: (r) => rate(r, 'cacheWrite1h') },
    { key: 'src', header: t('costs.rateSource'), headerLabel: t('costs.rateSource'), sortValue: (r) => r.rateSource ?? '', render: (r) => <SourceBadge source={r.rateSource} /> },
    { key: 'priced', header: t('costs.priced'), headerLabel: t('costs.priced'), sortValue: (r) => (r.priced ? 1 : 0), render: (r) => (r.priced ? <span className="badge good"><Icon name="check" size={13} />{t('costs.pricedYes')}</span> : <span className="badge warn"><Icon name="alert" size={13} />{t('costs.pricedNo')}</span>) },
    { key: 'usd', header: t('money.short'), headerLabel: t('money.short'), align: 'num', sortValue: (r) => (r.usdDecimal === null ? null : Number(r.usdDecimal)), render: (r) => <MoneyValue usd={r.priced ? r.usdDecimal : null} labelMode="sr" /> },
  ];
  return <DataTable caption={t('costs.byModel')} columns={cols} rows={rows} rowKey={(r) => r.modelId} defaultSort={{ key: 'tok', dir: 'desc' }} />;
}

export function CostsBody({ d, overrides }: { d: CostsDTO; overrides: RateEntry[] }) {
  const t = useT();
  const fmt = useFormat();
  const { disclaimer } = useMoneyText();
  const [editor, setEditor] = useState<{ prefill: string | null } | null>(null);
  const { cost } = d;
  const empty = d.byModel.length === 0;
  const lowCoverage = cost.requestCoverage < 1;
  const pricedLocal = d.byModel.some((m) => m.rateSource === 'user_override');

  return (
    <>
      <Card className="raised">
        <div className="costs-total">
          <div className="stack">
            <div className="row"><QualityBadge quality="estimated" reason="reason.estimatedValue" /><CoverageChip coverage={{ unpricedRequestCount: cost.unpricedRequestCount }} cost={cost} />{d.schedule.overrideCount > 0 ? <span className="badge warn local-badge"><Icon name="alert" size={13} />{t('costs.localCount', { count: d.schedule.overrideCount })}</span> : null}</div>
            <div className="kpi"><div className="value" style={{ fontSize: 44 }}><MoneyValue usd={cost.usdDecimal} /></div></div>
            <p className="small muted">{disclaimer}</p>
          </div>
          <dl className="kv">
            <dt>{t('coverage.tokenCoverage')}</dt><dd>{fmt.pct(cost.tokenCoverage, 1)}</dd>
            <dt>{t('costs.requestCoverage')}</dt><dd>{fmt.pct(cost.requestCoverage, 1)}</dd>
            <dt>{t('costs.pricedRequests')}</dt><dd>{fmt.num(cost.pricedRequestCount)}</dd>
            <dt>{t('costs.fallbackRequests')}</dt><dd>{fmt.num(cost.fallbackPricedRequestCount)}</dd>
            <dt>{t('costs.unpricedRequests')}</dt><dd>{fmt.num(cost.unpricedRequestCount)}</dd>
            <dt>{t('coverage.rateVersion')}</dt><dd className="mono wrap-safe">{cost.rateScheduleVersion}</dd>
          </dl>
        </div>
      </Card>

      {lowCoverage && !empty ? (
        <div className="notice warn" role="alert"><Icon name="alert" size={16} /><span>{t('costs.coverageWarning', { pct: fmt.pct(cost.requestCoverage, 1), count: cost.unpricedRequestCount })}</span></div>
      ) : null}

      {empty ? <EmptyState title={t('costs.empty.title')} body={t('costs.empty.body')} /> : (
        <>
          <Card title={t('costs.daily')}>
            <p className="small muted" style={{ marginTop: -6 }}>{t('chart.valueNote')}</p>
            <DailyChartLazy daily={d.daily} metric="value" />
          </Card>

          <div className="grid two">
            <Card title={t('costs.byCategory')}>
              <CategoryTable d={d} />
              <p className="small muted" style={{ marginTop: 10 }}>{t('costs.categoryNote')}</p>
            </Card>
            <Card title={t('costs.scheduleTitle')} aside={<button type="button" className="btn sm" onClick={() => setEditor({ prefill: null })}><Icon name="gear" size={14} />{t('rates.manage')}</button>}>
              <dl className="kv">
                <dt>{t('coverage.rateVersion')}</dt><dd className="mono wrap-safe">{d.schedule.version}</dd>
                <dt>{t('costs.sourceUrl')}</dt><dd className="mono wrap-safe">{d.schedule.sourceUrl}</dd>
                <dt>{t('costs.lastVerified')}</dt><dd>{d.schedule.lastVerified}</dd>
                <dt>{t('costs.overrides')}</dt><dd>{fmt.num(d.schedule.overrideCount)}</dd>
              </dl>
              <h3 style={{ margin: '14px 0 6px' }}>{t('costs.notModeled')}</h3>
              <p className="small muted">{t('costs.notModeledHelp')}</p>
              <ul className="small stack" style={{ margin: 0, paddingLeft: 18 }}>{d.schedule.notModeled.map((n) => <li key={n} className="wrap-safe">{n}</li>)}</ul>
            </Card>
          </div>

          <Card title={t('costs.byModel')} aside={pricedLocal ? <span className="badge warn local-badge"><Icon name="alert" size={13} />{t('rates.source.localApplies')}</span> : undefined}>
            <p className="small muted" style={{ marginTop: -6 }}>{t('costs.rateCardNote')}</p>
            <ModelTable rows={d.byModel} />
          </Card>

          {d.unpriced.length > 0 ? (
            <Card title={t('costs.unpricedTitle')} className="raised">
              <p>{t('costs.unpricedBody')}</p>
              <ul className="stack" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {d.unpriced.map((u) => {
                  const missing = u.modelId === MISSING_MODEL_ID;
                  return (
                    <li key={u.modelId} className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="wrap-safe"><strong className="mono">{u.modelId}</strong> <span className="small muted">{t('costs.unpricedRow', { requests: fmt.num(u.requests), tokens: fmt.num(u.tokens) })}</span></span>
                      <span className="row">
                        <button type="button" className="btn sm" disabled={missing} onClick={() => setEditor({ prefill: u.modelId })} aria-describedby={missing ? 'miss-model' : undefined}>{t('costs.definePrice')}</button>
                        {missing ? <span id={'miss-model'} className="small muted">{t('costs.definePrice.missingModel')}</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}
        </>
      )}
      <p className="small muted">{t('money.footnote')}</p>
      {editor ? <RateEditor entries={overrides} prefillModelId={editor.prefill} onClose={() => setEditor(null)} /> : null}
    </>
  );
}

export function Costs() {
  const t = useT();
  const f = useFilters();
  const q = useCosts(f.query);
  const settings = useSettings();
  return (
    <>
      <PageHeader eyebrow={t('nav.costs')} title={t('costs.title')} lead={t('costs.lead')} />
      <EntityFilters models />
      <Query q={q} skeleton={420}>{(d) => <CostsBody d={d} overrides={settings.data?.rateOverrides ?? []} />}</Query>
    </>
  );
}
