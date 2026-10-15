import { useMemo, useState, type ReactNode } from 'react';
import { useT } from '../i18n';
import { Icon } from './icons';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** header text for aria when `header` is not plain text */
  headerLabel?: string;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => number | string | null;
  align?: 'num';
  className?: string;
}

export function DataTable<T>({ columns, rows, rowKey, defaultSort, caption, empty }: { columns: Column<T>[]; rows: T[]; rowKey: (r: T) => string; defaultSort?: { key: string; dir: 'asc' | 'desc' }; caption: string; empty?: ReactNode }) {
  const t = useT();
  const [sort, setSort] = useState(defaultSort ?? null);
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sort?.key);
    if (!sort || !col?.sortValue) return rows;
    const sv = col.sortValue;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = sv(a);
      const y = sv(b);
      if (x === y) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * dir;
    });
  }, [rows, sort, columns]);

  return (
    <div>
      <div className="table-scroll" role="region" aria-label={caption} tabIndex={0}>
        <table className="data">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th key={c.key} scope="col" className={c.align ?? ''} aria-sort={c.sortValue ? (active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}>
                    {c.sortValue ? (
                      <button type="button" className="th-btn" onClick={() => setSort(active && sort.dir === 'desc' ? { key: c.key, dir: 'asc' } : { key: c.key, dir: 'desc' })} title={t('table.sortBy', { column: c.headerLabel ?? '' })}>
                        {c.header}
                        <Icon name={active ? (sort.dir === 'asc' ? 'up' : 'down') : 'chevD'} size={13} />
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={rowKey(r)}>
                {columns.map((c) => (
                  <td key={c.key} className={`${c.align ?? ''} ${c.className ?? ''}`}>
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length === 0 ? <div style={{ padding: 16 }}>{empty ?? <span className="muted">{t('state.noRows')}</span>}</div> : null}
      </div>
      <p className="table-hint">{t('table.scrollHint')}</p>
    </div>
  );
}
