import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { DailyPoint, ModelSlice } from '@orbit/core';
import { useFormat, useT } from '../i18n';
import { MoneyValue, useMoneyText } from './badges';
import { TOKEN_KEYS } from './TokenMix';

export type DailyMetric = 'tokens' | 'value' | 'requests';

const MODEL_COLORS = ['var(--accent)', 'var(--teal)', 'var(--coral)', 'var(--violet)', 'var(--green)', '#c9b79c', '#7f9bd1', '#c47fa8'];

export function DailyChart({ daily, metric }: { daily: DailyPoint[]; metric: DailyMetric }) {
  const t = useT();
  const fmt = useFormat();
  const { label: moneyLabel } = useMoneyText();
  const data = daily.map((d) => ({
    date: d.date,
    ...d.tokens,
    value: Number(d.usdDecimal),
    requests: d.uniqueRequests,
  }));
  const yFmt = (v: number) => (metric === 'value' ? fmt.usd(v) : metric === 'requests' ? fmt.num(v) : fmt.compact(v));
  const summary = `${t(`chart.metric.${metric}`)}: ${daily.length} ${t('chart.days')}`;
  return (
    <div>
      <div className="chart-box" role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--line)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={(v: string) => fmt.day(v)} tickLine={false} axisLine={{ stroke: 'var(--line)' }} minTickGap={24} />
            <YAxis tickFormatter={yFmt} tickLine={false} axisLine={false} width={64} />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,.05)' }}
              contentStyle={{ background: 'var(--bg-raised)', border: '1px solid var(--line-strong)', borderRadius: 8, color: 'var(--text-primary)' }}
              labelFormatter={(v) => fmt.day(String(v), true)}
              formatter={(v, name) => [yFmt(Number(v)), name === 'value' ? moneyLabel : name === 'requests' ? t('chart.metric.requests') : t(`tokens.${String(name)}`)]}
            />
            {metric === 'tokens' ? TOKEN_KEYS.map((k) => <Bar key={k} dataKey={k} stackId="t" fill={`var(--c-${k})`} stroke="var(--bg-panel)" strokeWidth={0.5} isAnimationActive={false} />) : null}
            {metric === 'value' ? <Bar dataKey="value" fill="var(--accent)" isAnimationActive={false} /> : null}
            {metric === 'requests' ? <Bar dataKey="requests" fill="var(--teal)" isAnimationActive={false} /> : null}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {metric === 'tokens' ? (
        <ul className="legend">
          {TOKEN_KEYS.map((k) => (
            <li key={k}>
              <span className="swatch" style={{ background: `var(--c-${k})` }} aria-hidden="true" />
              {t(`tokens.${k}`)}
            </li>
          ))}
        </ul>
      ) : null}
      <details className="alt">
        <summary>{t('chart.showTable')}</summary>
        <div className="table-scroll" role="region" aria-label={t('chart.showTable')} tabIndex={0}>
          <table className="data">
            <caption className="sr-only">{summary}</caption>
            <thead>
              <tr>
                <th scope="col">{t('col.date')}</th>
                {metric === 'tokens' ? TOKEN_KEYS.map((k) => <th key={k} scope="col" className="num">{t(`tokens.${k}`)}</th>) : metric === 'value' ? <th scope="col" className="num">{moneyLabel}</th> : <th scope="col" className="num">{t('chart.metric.requests')}</th>}
              </tr>
            </thead>
            <tbody>
              {daily.map((d) => (
                <tr key={d.date}>
                  <th scope="row">{fmt.day(d.date, true)}</th>
                  {metric === 'tokens' ? TOKEN_KEYS.map((k) => <td key={k} className="num">{fmt.num(d.tokens[k])}</td>) : metric === 'value' ? <td className="num"><MoneyValue usd={d.usdDecimal} labelMode="sr" /></td> : <td className="num">{fmt.num(d.uniqueRequests)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export function ModelDonut({ models }: { models: ModelSlice[] }) {
  const t = useT();
  const fmt = useFormat();
  const total = models.reduce((a, m) => a + m.tokens.processed, 0);
  const data = models.map((m, i) => ({ name: m.displayName ?? m.modelId, id: m.modelId, value: m.tokens.processed, color: MODEL_COLORS[i % MODEL_COLORS.length] as string }));
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(140px, 180px) 1fr', gap: 16, alignItems: 'center' }}>
        <div className="chart-box sm" style={{ position: 'relative', height: 180 }} role="img" aria-label={`${t('card.models')}: ${data.map((d) => `${d.name} ${fmt.pct(total ? d.value / total : 0)}`).join(', ')}`}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" innerRadius="62%" outerRadius="92%" stroke="var(--bg-panel)" strokeWidth={2} isAnimationActive={false}>
                {data.map((d) => <Cell key={d.id} fill={d.color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none', textAlign: 'center' }}>
            <div><strong style={{ fontFamily: 'var(--font-serif)', fontSize: 20 }}>{fmt.compact(total)}</strong><div className="small muted">{t('tokens.processed')}</div></div>
          </div>
        </div>
        <ul className="legend" style={{ flexDirection: 'column', gap: 8, fontSize: 14 }}>
          {models.map((m, i) => (
            <li key={m.modelId} style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0,1fr) auto', gap: 8, alignItems: 'baseline' }}>
              <span className="swatch" style={{ background: MODEL_COLORS[i % MODEL_COLORS.length] }} aria-hidden="true" />
              <span className="trunc" title={m.modelId} style={{ color: 'var(--text-primary)' }}>{m.displayName ?? m.modelId}{!m.priced ? ` (${t('money.unpricedShort')})` : ''}</span>
              <span>{fmt.pct(total ? m.tokens.processed / total : 0)} · {fmt.compact(m.tokens.processed)}</span>
            </li>
          ))}
        </ul>
      </div>
      <details className="alt">
        <summary>{t('chart.showTable')}</summary>
        <div className="table-scroll" role="region" aria-label={t('chart.showTable')} tabIndex={0}>
          <table className="data">
            <caption className="sr-only">{t('card.models')}</caption>
            <thead><tr><th scope="col">{t('col.model')}</th><th scope="col" className="num">{t('col.requests')}</th><th scope="col" className="num">{t('tokens.processed')}</th><th scope="col" className="num">{t('money.short')}</th></tr></thead>
            <tbody>
              {models.map((m) => (
                <tr key={m.modelId}><th scope="row" className="wrap-safe">{m.displayName ?? m.modelId}</th><td className="num">{fmt.num(m.requests)}</td><td className="num">{fmt.num(m.tokens.processed)}</td><td className="num"><MoneyValue usd={m.priced ? m.usdDecimal : null} labelMode="sr" /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export function RequestsAreaChart({ points }: { points: { t: number; processed: number }[] }) {
  const t = useT();
  const fmt = useFormat();
  return (
    <div className="chart-box sm" role="img" aria-label={t('card.usageOverTime')}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={(v: number) => fmt.time(new Date(v).toISOString())} tickLine={false} axisLine={{ stroke: 'var(--line)' }} />
          <YAxis tickFormatter={(v: number) => fmt.compact(v)} tickLine={false} axisLine={false} width={56} />
          <Tooltip contentStyle={{ background: 'var(--bg-raised)', border: '1px solid var(--line-strong)', borderRadius: 8 }} labelFormatter={(v) => fmt.dateTime(new Date(Number(v)).toISOString())} formatter={(v) => [fmt.num(Number(v)), t('tokens.processed')]} />
          <Area type="monotone" dataKey="processed" stroke="var(--accent)" fill="var(--accent)" fillOpacity={0.18} dot={{ r: 2 }} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
