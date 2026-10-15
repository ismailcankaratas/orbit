import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_LOCALE, LOCALES, LOCALE_IDS, isLocale, type LocaleId } from './registry';
import { translate, type Params } from './translate';
import { browserTz, makeFormatters, type Formatters, validTz } from './format';

export type TFn = (key: string, params?: Params) => string;

interface Ctx {
  locale: LocaleId;
  setLocale: (l: LocaleId) => void;
  timezone: string;
  setTimezone: (tz: string) => void;
  t: TFn;
  fmt: Formatters;
}

const I18nContext = createContext<Ctx | null>(null);
const LS_LOCALE = 'orbit.locale';
const LS_TZ = 'orbit.tz';

function readLs(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLs(key: string, v: string) {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* storage unavailable: ignore */
  }
}

export function I18nProvider({ children, initialLocale, initialTimezone }: { children: ReactNode; initialLocale?: LocaleId; initialTimezone?: string }) {
  const [locale, setLocaleState] = useState<LocaleId>(() => {
    const ls = readLs(LS_LOCALE);
    return initialLocale ?? (isLocale(ls) ? ls : DEFAULT_LOCALE);
  });
  const [timezone, setTz] = useState<string>(() => {
    const ls = readLs(LS_TZ);
    return initialTimezone ?? (ls && validTz(ls) ? ls : browserTz());
  });
  const setLocale = useCallback((l: LocaleId) => {
    setLocaleState(l);
    writeLs(LS_LOCALE, l);
  }, []);
  const setTimezone = useCallback((tz: string) => {
    if (!validTz(tz)) return;
    setTz(tz);
    writeLs(LS_TZ, tz);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const value = useMemo<Ctx>(
    () => ({ locale, setLocale, timezone, setTimezone, t: (k, p) => translate(locale, k, p), fmt: makeFormatters(locale, timezone) }),
    [locale, setLocale, timezone, setTimezone],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const c = useContext(I18nContext);
  if (!c) throw new Error('I18nProvider missing');
  return c;
}
export const useT = (): TFn => useI18n().t;
export const useFormat = (): Formatters => useI18n().fmt;
export { LOCALES, LOCALE_IDS, isLocale };
export type { LocaleId };
