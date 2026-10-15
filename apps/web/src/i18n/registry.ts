import tr from './locales/tr.json';
import en from './locales/en.json';

export type Messages = Record<string, string>;

/**
 * Locale registry. To add a locale: drop `locales/<id>.json` (same keys as tr.json),
 * import it above and add ONE line below. See src/i18n/README.md.
 */
export const LOCALES = {
  tr: { label: 'Türkçe', intl: 'tr-TR', messages: tr as Messages },
  en: { label: 'English', intl: 'en-US', messages: en as Messages },
} as const;

export type LocaleId = keyof typeof LOCALES;
export const DEFAULT_LOCALE: LocaleId = 'tr';
export const LOCALE_IDS = Object.keys(LOCALES) as LocaleId[];

export function isLocale(x: unknown): x is LocaleId {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(LOCALES, x);
}
