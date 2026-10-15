import tr from './locales/tr.json';
import en from './locales/en.json';
// Module namespaces (ADR-003): each experience module owns its own catalog file so
// parallel work never edits the same JSON. Keys MUST be prefixed: shell.*, scene.merkez.*, ask.*
import shellTr from './locales/modules/shell.tr.json';
import shellEn from './locales/modules/shell.en.json';
import merkezTr from './locales/modules/merkez.tr.json';
import merkezEn from './locales/modules/merkez.en.json';
import askTr from './locales/modules/ask.tr.json';
import askEn from './locales/modules/ask.en.json';

export type Messages = Record<string, string>;

const merge = (...parts: object[]): Messages => Object.assign({}, ...parts) as Messages;

/**
 * Locale registry. To add a locale: add `locales/<id>.json` + `locales/modules/<module>.<id>.json`
 * (same keys as Turkish), import them above and add ONE line below. See src/i18n/README.md.
 */
export const LOCALES = {
  tr: { label: 'Türkçe', intl: 'tr-TR', messages: merge(tr, shellTr, merkezTr, askTr) },
  en: { label: 'English', intl: 'en-US', messages: merge(en, shellEn, merkezEn, askEn) },
} as const;

export type LocaleId = keyof typeof LOCALES;
export const DEFAULT_LOCALE: LocaleId = 'tr';
export const LOCALE_IDS = Object.keys(LOCALES) as LocaleId[];

export function isLocale(x: unknown): x is LocaleId {
  return typeof x === 'string' && Object.prototype.hasOwnProperty.call(LOCALES, x);
}
