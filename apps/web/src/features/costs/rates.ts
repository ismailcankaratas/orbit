import type { RateCard, RateEntry } from '@orbit/core';

/** Client-side mirror of the server's zod rules (packages/core/src/cost/schedule.ts). Messages are i18n error codes. */
export const RATE_KEYS = ['input', 'output', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h'] as const;
export type RateKey = (typeof RATE_KEYS)[number];

export interface RateDraft {
  modelId: string;
  displayName: string;
  /** comma separated */
  aliases: string;
  /** YYYY-MM-DD (UTC midnight) */
  effectiveFrom: string;
  effectiveTo: string;
  rates: Record<RateKey, string>;
}

export type RateErrorCode = 'required' | 'length' | 'decimal' | 'date' | 'range' | 'overlap';
export type RateErrors = Partial<Record<'modelId' | 'displayName' | 'aliases' | 'effectiveFrom' | 'effectiveTo' | RateKey, RateErrorCode>>;

const DECIMAL = /^\d{1,6}(\.\d{1,6})?$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (s: string) => YMD.test(s) && !Number.isNaN(Date.parse(s));

export const emptyDraft = (modelId = ''): RateDraft => ({
  modelId,
  displayName: modelId,
  aliases: '',
  effectiveFrom: '2020-01-01',
  effectiveTo: '',
  rates: { input: '', output: '', cacheRead: '', cacheWrite5m: '', cacheWrite1h: '' },
});

export const draftFromEntry = (e: RateEntry): RateDraft => ({
  modelId: e.modelId,
  displayName: e.displayName,
  aliases: e.aliases.join(', '),
  effectiveFrom: e.effectiveFrom.slice(0, 10),
  effectiveTo: e.effectiveTo ? e.effectiveTo.slice(0, 10) : '',
  rates: { ...e.rates },
});

export function parseAliases(s: string): string[] {
  return s.split(',').map((a) => a.trim()).filter(Boolean);
}

export function validateDraft(d: RateDraft): { errors: RateErrors; entry: RateEntry | null } {
  const errors: RateErrors = {};
  const id = d.modelId.trim();
  if (!id) errors.modelId = 'required';
  else if (id.length > 128) errors.modelId = 'length';
  const name = d.displayName.trim();
  if (!name) errors.displayName = 'required';
  else if (name.length > 128) errors.displayName = 'length';
  if (parseAliases(d.aliases).some((a) => a.length > 128)) errors.aliases = 'length';
  if (!d.effectiveFrom) errors.effectiveFrom = 'required';
  else if (!isDate(d.effectiveFrom)) errors.effectiveFrom = 'date';
  if (d.effectiveTo) {
    if (!isDate(d.effectiveTo)) errors.effectiveTo = 'date';
    else if (!errors.effectiveFrom && Date.parse(d.effectiveTo) <= Date.parse(d.effectiveFrom)) errors.effectiveTo = 'range';
  }
  for (const k of RATE_KEYS) {
    const v = d.rates[k].trim();
    if (!v) errors[k] = 'required';
    else if (!DECIMAL.test(v)) errors[k] = 'decimal';
  }
  if (Object.keys(errors).length) return { errors, entry: null };
  const rates = Object.fromEntries(RATE_KEYS.map((k) => [k, d.rates[k].trim()])) as unknown as RateCard;
  return {
    errors,
    entry: {
      modelId: id,
      displayName: name,
      aliases: parseAliases(d.aliases),
      effectiveFrom: `${d.effectiveFrom}T00:00:00.000Z`,
      effectiveTo: d.effectiveTo ? `${d.effectiveTo}T00:00:00.000Z` : null,
      rates,
      source: 'user_override',
    },
  };
}

/** Same-model intervals must not overlap (mirrors server findOverlap). Returns true when `entries` is clean. */
export function hasOverlap(entries: RateEntry[]): boolean {
  const groups = new Map<string, RateEntry[]>();
  for (const e of entries) {
    const k = e.modelId.toLowerCase();
    groups.set(k, [...(groups.get(k) ?? []), e]);
  }
  for (const g of groups.values()) {
    const s = [...g].sort((a, b) => Date.parse(a.effectiveFrom) - Date.parse(b.effectiveFrom));
    for (let i = 1; i < s.length; i++) {
      const prev = s[i - 1] as RateEntry;
      const cur = s[i] as RateEntry;
      if (prev.effectiveTo === null || Date.parse(prev.effectiveTo) > Date.parse(cur.effectiveFrom)) return true;
    }
  }
  return false;
}

/** Server placeholder for requests whose log line has no model id (apps/server filters.ts MISSING_MODEL). */
export const MISSING_MODEL_ID = '(missing model)';
