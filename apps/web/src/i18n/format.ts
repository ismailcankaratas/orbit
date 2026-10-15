import { LOCALES, type LocaleId } from './registry';

export interface Formatters {
  locale: LocaleId;
  tz: string;
  num: (n: number, maxFrac?: number) => string;
  compact: (n: number) => string;
  pct: (ratio: number, digits?: number) => string;
  /** Always USD. Accepts the API's decimal string. */
  usd: (v: string | number) => string;
  dateTime: (iso: string) => string;
  date: (iso: string) => string;
  time: (iso: string) => string;
  /** local calendar day "YYYY-MM-DD" (already bucketed in tz) */
  day: (ymd: string, withYear?: boolean) => string;
  duration: (ms: number) => string;
}

export function makeFormatters(locale: LocaleId, tz: string): Formatters {
  const { intl, messages } = LOCALES[locale];
  const m = (k: string) => messages[k] ?? LOCALES.en.messages[k] ?? '';
  const nf = (o?: Intl.NumberFormatOptions) => new Intl.NumberFormat(intl, o);
  const safeTz = validTz(tz) ? tz : 'UTC';
  const dtf = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(intl, { timeZone: safeTz, ...o });
  const d = (iso: string) => new Date(iso);
  const ok = (iso: string) => !Number.isNaN(d(iso).getTime());

  const compact = (n: number): string => {
    const abs = Math.abs(n);
    if (abs < 1000) return nf({ maximumFractionDigits: 0 }).format(n);
    const divs = [1e3, 1e6, 1e9];
    const keys = ['thousand', 'million', 'billion'];
    let i = abs >= 1e9 ? 2 : abs >= 1e6 ? 1 : 0;
    let v = n / (divs[i] as number);
    if (Math.abs(Math.round(v * 10) / 10) >= 1000 && i < 2) {
      i += 1;
      v = n / (divs[i] as number);
    }
    return nf({ maximumFractionDigits: 1 }).format(v) + m(`format.compact.${keys[i]}`);
  };

  return {
    locale,
    tz: safeTz,
    num: (n, maxFrac = 0) => nf({ maximumFractionDigits: maxFrac }).format(n),
    compact,
    pct: (r, digits = 0) => nf({ style: 'percent', maximumFractionDigits: digits }).format(r),
    usd: (v) => {
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) return '—';
      const small = n !== 0 && Math.abs(n) < 0.01;
      return nf({ style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: small ? 4 : 2 }).format(n);
    },
    dateTime: (iso) =>
      ok(iso) ? dtf({ year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' }).format(d(iso)) : '—',
    date: (iso) => (ok(iso) ? dtf({ year: 'numeric', month: 'short', day: 'numeric' }).format(d(iso)) : '—'),
    time: (iso) => (ok(iso) ? dtf({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d(iso)) : '—'),
    day: (ymd, withYear = false) => {
      const [y, mo, da] = ymd.split('-').map(Number);
      if (!y || !mo || !da) return ymd;
      return new Intl.DateTimeFormat(intl, { timeZone: 'UTC', day: 'numeric', month: 'short', ...(withYear ? { year: 'numeric' } : {}) }).format(new Date(Date.UTC(y, mo - 1, da, 12)));
    },
    duration: (ms) => {
      if (!Number.isFinite(ms) || ms < 0) return '—';
      const s = Math.floor(ms / 1000);
      if (s < 1) return `<1 ${m('format.unit.second')}`;
      const parts: [number, string][] = [
        [Math.floor(s / 86400), m('format.unit.day')],
        [Math.floor((s % 86400) / 3600), m('format.unit.hour')],
        [Math.floor((s % 3600) / 60), m('format.unit.minute')],
        [s % 60, m('format.unit.second')],
      ];
      return parts.filter(([v]) => v > 0).slice(0, 2).map(([v, u]) => `${v} ${u}`).join(' ');
    },
  };
}

export function validTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function browserTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
