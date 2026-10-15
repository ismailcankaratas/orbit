import type { DailyPoint } from '@orbit/core';
import { useFormat, useT } from '../../i18n';

/** Self-contained inline SVG/CSS charts (no chart library) so every slide can be rendered, hidden and printed. */
export function DailyBars({ daily }: { daily: DailyPoint[] }) {
  const t = useT();
  const fmt = useFormat();
  const W = 640;
  const H = 170;
  const max = Math.max(1, ...daily.map((d) => d.tokens.processed));
  const n = Math.max(1, daily.length);
  const bw = W / n;
  const first = daily[0];
  const last = daily[daily.length - 1];
  return (
    <figure className="story-fig">
      <svg viewBox={`0 0 ${W} ${H + 22}`} role="img" aria-label={`${t('story.s2.chart')}: ${daily.length} ${t('chart.days')}, ${t('story.max')} ${fmt.compact(max)}`} className="story-svg">
        <line x1="0" x2={W} y1={H} y2={H} stroke="var(--line-strong)" />
        {daily.map((d, i) => {
          const h = (d.tokens.processed / max) * (H - 8);
          return <rect key={d.date} x={i * bw + Math.min(2, bw * 0.15)} y={H - h} width={Math.max(1, bw - Math.min(4, bw * 0.3))} height={h} fill="var(--accent)" rx="1.5" />;
        })}
        {first && last ? (
          <>
            <text x="0" y={H + 16} fontSize="12" fill="var(--text-secondary)">{fmt.day(first.date, true)}</text>
            <text x={W} y={H + 16} fontSize="12" textAnchor="end" fill="var(--text-secondary)">{fmt.day(last.date, true)}</text>
          </>
        ) : null}
        <text x="0" y="12" fontSize="12" fill="var(--text-secondary)">{fmt.compact(max)}</text>
      </svg>
      <table className="sr-only">
        <caption>{t('story.s2.chart')}</caption>
        <thead><tr><th scope="col">{t('col.date')}</th><th scope="col">{t('tokens.processed')}</th></tr></thead>
        <tbody>{daily.map((d) => <tr key={d.date}><th scope="row">{d.date}</th><td>{d.tokens.processed}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

export interface BarRow {
  key: string;
  label: string;
  share: number;
  text: string;
  tone?: string;
}

export function HBars({ rows, label }: { rows: BarRow[]; label: string }) {
  return (
    <ol className="story-bars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key}>
          <span className="trunc story-bar-label" title={r.label}>{r.label}</span>
          <span className="bar-track" aria-hidden="true"><i style={{ width: `${Math.max(1, Math.min(100, r.share * 100))}%`, ...(r.tone ? { background: r.tone } : {}) }} /></span>
          <span className="nowrap story-bar-val">{r.text}</span>
        </li>
      ))}
    </ol>
  );
}
