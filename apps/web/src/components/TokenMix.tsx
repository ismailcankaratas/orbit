import type { TokenTotals } from '@orbit/core';
import { useFormat, useT } from '../i18n';

export const TOKEN_KEYS = ['uncachedInput', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h', 'unsplitCacheWrite'] as const;
export type TokenKey = (typeof TOKEN_KEYS)[number];

export function TokenMixBar({ tokens }: { tokens: TokenTotals }) {
  const t = useT();
  const fmt = useFormat();
  const total = tokens.processed || 1;
  const desc = TOKEN_KEYS.map((k) => `${t(`tokens.${k}`)}: ${fmt.pct(tokens[k] / total)}`).join(', ');
  return (
    <div className="mixbar" role="img" aria-label={`${t('tokens.mix')}: ${desc}`} title={desc}>
      {TOKEN_KEYS.map((k) => (tokens[k] > 0 ? <i key={k} style={{ width: `${(tokens[k] / total) * 100}%`, background: `var(--c-${k})` }} /> : null))}
    </div>
  );
}

export function TokenLegend({ tokens }: { tokens: TokenTotals }) {
  const t = useT();
  const fmt = useFormat();
  return (
    <ul className="legend">
      {TOKEN_KEYS.filter((k) => tokens[k] > 0).map((k) => (
        <li key={k}>
          <span className="swatch" style={{ background: `var(--c-${k})` }} aria-hidden="true" />
          {t(`tokens.${k}`)} {fmt.compact(tokens[k])}
        </li>
      ))}
    </ul>
  );
}
