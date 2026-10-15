import { useCallback, useMemo } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { useI18n } from '../i18n';
import { addDays, dayStartIso, isYmd, todayIn } from './dates';
import type { Query } from './client';

export const FILTER_KEYS = ['range', 'from', 'to', 'project', 'model'] as const;
export const PRESETS = [7, 30, 90] as const;

export interface Filters {
  from: string;
  to: string;
  preset: number | null;
  project: string | null;
  model: string | null;
  tz: string;
  /** API query: from/to are UTC instants of local midnight; `to` is exclusive (start of the day after the last selected day). */
  query: Query;
  /** search string (with leading ?) carrying only filter params, for links */
  search: string;
  setPreset: (days: number) => void;
  setRange: (from: string, to: string) => void;
  setEntity: (key: 'project' | 'model', value: string | null) => void;
}

export function useFilters(): Filters {
  const { timezone: tz } = useI18n();
  const [sp, setSp] = useSearchParams();
  const rangeP = sp.get('range');
  const fromP = sp.get('from');
  const toP = sp.get('to');
  const project = sp.get('project');
  const model = sp.get('model');

  const base = useMemo(() => {
    const today = todayIn(tz);
    if (isYmd(fromP) && isYmd(toP) && fromP <= toP) return { from: fromP, to: toP, preset: null as number | null };
    const n = PRESETS.find((p) => String(p) === rangeP) ?? 30;
    return { from: addDays(today, -(n - 1)), to: today, preset: n as number | null };
  }, [tz, rangeP, fromP, toP]);

  const query = useMemo<Query>(
    () => ({
      from: dayStartIso(base.from, tz),
      to: dayStartIso(addDays(base.to, 1), tz),
      tz,
      projectId: project,
      modelId: model,
    }),
    [base, tz, project, model],
  );

  const search = useMemo(() => {
    const o = new URLSearchParams();
    for (const k of FILTER_KEYS) {
      const v = sp.get(k);
      if (v) o.set(k, v);
    }
    const s = o.toString();
    return s ? `?${s}` : '';
  }, [sp]);

  const update = useCallback(
    (fn: (n: URLSearchParams) => void) => {
      setSp(
        (prev) => {
          const n = new URLSearchParams(prev);
          fn(n);
          return n;
        },
        { replace: false },
      );
    },
    [setSp],
  );

  return {
    ...base,
    project,
    model,
    tz,
    query,
    search,
    setPreset: (days) =>
      update((n) => {
        n.set('range', String(days));
        n.delete('from');
        n.delete('to');
      }),
    setRange: (from, to) =>
      update((n) => {
        n.delete('range');
        n.set('from', from);
        n.set('to', to);
      }),
    setEntity: (key, value) =>
      update((n) => {
        if (value) n.set(key, value);
        else n.delete(key);
      }),
  };
}

/** Append the current filter params to an in-app path (so deep links/navigation preserve filters). */
export function useFilterHref() {
  const { search } = useFilters();
  return useCallback((path: string, extra?: Record<string, string>) => {
    const [p, own = ''] = path.split('?');
    const n = new URLSearchParams(search);
    for (const [k, v] of new URLSearchParams(own)) n.set(k, v);
    if (extra) for (const [k, v] of Object.entries(extra)) n.set(k, v);
    const s = n.toString();
    return s ? `${p}?${s}` : (p as string);
  }, [search]);
}

export function useIsDataRoute(): boolean {
  const { pathname } = useLocation();
  // /reports hosts its own range controls in the builder card.
  return /^\/(overview|projects|sessions|agents|timeline|costs|reports)?(\/|$)/.test(pathname) && !pathname.startsWith('/settings') && pathname.replace(/\/$/, '') !== '/reports';
}
