import { LOCALES, type LocaleId } from './registry';

export type Params = Record<string, string | number>;

/** Pure translation: `{name}` interpolation + plural suffixes (`key.one` / `key.other`) via Intl.PluralRules when `count` is given. */
export function translate(locale: LocaleId, key: string, params?: Params): string {
  const { messages, intl } = LOCALES[locale];
  let tpl: string | undefined;
  if (params && typeof params.count === 'number') {
    const cat = new Intl.PluralRules(intl).select(params.count);
    tpl = messages[`${key}.${cat}`] ?? messages[`${key}.other`];
  }
  tpl ??= messages[key] ?? LOCALES.en.messages[key];
  if (tpl === undefined) return key;
  if (!params) return tpl;
  const nf = new Intl.NumberFormat(intl);
  return tpl.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = params[name];
    if (v === undefined) return m;
    return typeof v === 'number' ? nf.format(v) : v;
  });
}

export function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string);
}
