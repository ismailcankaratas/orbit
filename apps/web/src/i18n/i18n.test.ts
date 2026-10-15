import { describe, expect, it } from 'vitest';
import { EXPORT_COLUMNS } from '@orbit/core';
import { LOCALES, LOCALE_IDS } from './registry';
import { placeholders, translate } from './translate';

const tr = LOCALES.tr.messages;
const sources = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('i18n catalogs', () => {
  it('every locale has exactly the same keys as tr', () => {
    for (const id of LOCALE_IDS) {
      const keys = Object.keys(LOCALES[id].messages).sort();
      expect(keys, id).toEqual(Object.keys(tr).sort());
    }
  });
  it('has no empty strings', () => {
    for (const id of LOCALE_IDS) for (const [k, v] of Object.entries(LOCALES[id].messages)) expect(v.trim().length, `${id}:${k}`).toBeGreaterThan(0);
  });
  it('uses the same {placeholders} in every locale', () => {
    for (const id of LOCALE_IDS) for (const [k, v] of Object.entries(LOCALES[id].messages)) expect(placeholders(v).sort(), `${id}:${k}`).toEqual(placeholders(tr[k] as string).sort());
  });

  it('every literal t("...") key used in source exists (plural bases allowed)', () => {
    const used = new Set<string>();
    for (const [file, src] of Object.entries(sources)) {
      if (file.includes('.test.')) continue;
      for (const m of src.matchAll(/\bt\(\s*['"]([\w.]+)['"]/g)) used.add(m[1] as string);
    }
    expect(used.size).toBeGreaterThan(100);
    const missing = [...used].filter((k) => !(k in tr) && !(`${k}.other` in tr));
    expect(missing).toEqual([]);
  });

  it('covers every dynamically built key family', () => {
    const codes = ['SOURCE_NOT_FOUND', 'PERMISSION_DENIED', 'SCAN_IN_PROGRESS', 'PARTIAL_TRANSCRIPT', 'RATE_NOT_FOUND', 'UNSUPPORTED_SOURCE_SCHEMA', 'INVALID_FILTER', 'EXPORT_TOO_LARGE', 'APP_ARCHIVE_NOT_INITIALIZED', 'NO_COVERAGE', 'CROSS_ORIGIN_DENIED', 'CSRF_REQUIRED', 'CONSENT_REQUIRED', 'NOT_FOUND', 'RATE_LIMITED', 'INTERNAL', 'NETWORK'];
    const keys: string[] = [
      ...codes.flatMap((c) => [`error.${c}.title`, `error.${c}.body`]),
      ...['observed', 'derived', 'estimated', 'unknown'].flatMap((q) => [`quality.${q}`, `quality.${q}.help`]),
      ...['exact', 'inferred', 'unlinked', 'unknown'].map((c) => `confidence.${c}`),
      ...['observed_recently', 'historical', 'unknown'].map((s) => `status.${s}`),
      ...['complete', 'partial', 'empty', 'not_scanned'].map((s) => `coverage.status.${s}`),
      ...['watching', 'polling', 'off', 'error'].flatMap((w) => [`watcher.${w}`, `watcher.${w}.help`]),
      ...['uncachedInput', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h', 'unsplitCacheWrite'].map((k) => `tokens.${k}`),
      ...['most_active_project', 'cache_read_share', 'delegation_share', 'busiest_day', 'unpriced_warning', 'model_leader'].map((k) => `insight.${k}`),
      ...['tokens', 'value', 'requests'].map((m) => `chart.metric.${m}`),
      ...['main', 'agent'].map((k) => `attr.kind.${k}`),
      ...['required', 'length', 'decimal', 'date', 'range', 'overlap'].map((k) => `rates.err.${k}`),
      ...['local', 'official', 'none'].map((k) => `rates.source.${k}`),
      ...['project', 'agent'].map((k) => `timeline.group.${k}`),
      ...['24h', '7d', '30d'].map((k) => `timeline.zoom.${k}`),
      ...['prompts', 'outputs', 'paths', 'secrets', 'requestIds', 'sessionIds'].map((k) => `reports.excluded.${k}`),
      ...EXPORT_COLUMNS.map((c) => `export.col.${c}`),
      ...['thousand', 'million', 'billion'].map((k) => `format.compact.${k}`),
      ...['day', 'hour', 'minute', 'second'].map((k) => `format.unit.${k}`),
    ];
    expect(keys.filter((k) => !(k in tr))).toEqual([]);
  });
});

describe('translate', () => {
  it('interpolates and pluralises', () => {
    expect(translate('en', 'count.sessions', { count: 1 })).toBe('1 session');
    expect(translate('en', 'count.sessions', { count: 3 })).toBe('3 sessions');
    expect(translate('tr', 'count.sessions', { count: 3 })).toBe('3 oturum');
    expect(translate('tr', 'coverage.chip', { pct: '%94', count: 6 })).toBe('%94 fiyatlandı · 6 fiyatsız istek');
  });
  it('returns the key for unknown keys', () => {
    expect(translate('tr', 'nope.nope')).toBe('nope.nope');
  });
});
