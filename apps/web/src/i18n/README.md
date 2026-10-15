# Orbit i18n

* Locale files: `locales/<id>.json` — flat `"dotted.key": "text"` maps. `tr.json` is the default and the reference key set.
* Interpolation: `t('key', { name })` replaces `{name}`. Numbers passed as params are formatted with the active locale.
* Plurals: define `key.one` and `key.other` (add `zero/few/many` where the language needs them) and call `t('key', { count })`.
  The category comes from `Intl.PluralRules`.
* Number/date/money formatting lives in `format.ts` (`useFormat()`): compact tokens use `format.compact.*` and
  `format.unit.*` from the locale file; currency is always USD (never converted).

## Add a locale
1. Copy `locales/en.json` to `locales/de.json` and translate every value.
2. In `registry.ts` import it and add one line to `LOCALES`: `de: { label: 'Deutsch', intl: 'de-DE', messages: de as Messages },`
3. Run `npx vitest run --project web` — `i18n.test.ts` fails if key sets differ, a value is empty, or a literal `t('…')` key used in source is missing.
4. The server's `settings.locale` is currently typed `'tr' | 'en'` in `@orbit/core`; widen it there before persisting a new locale server-side
   (until then the new locale is remembered in localStorage only).
