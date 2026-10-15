import { z } from 'zod';
import type { RateEntry, RateSchedule } from '../schemas/types.js';
import defaultJson from './rates/anthropic-2026-10-15.json' with { type: 'json' };

const dec = z.string().regex(/^\d{1,6}(\.\d{1,6})?$/, 'decimal USD/MTok, max 6+6 digits');
const iso = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'ISO date');

const rateCard = z.object({
  input: dec,
  output: dec,
  cacheRead: dec,
  cacheWrite5m: dec,
  cacheWrite1h: dec,
});

export const rateEntrySchema = z
  .object({
    modelId: z.string().min(1).max(128),
    displayName: z.string().min(1).max(128),
    aliases: z.array(z.string().min(1).max(128)),
    effectiveFrom: iso,
    effectiveTo: iso.nullable(),
    rates: rateCard,
    longPromptTier: z
      .object({ thresholdTokens: z.number().int().positive(), rates: rateCard })
      .optional(),
    source: z.enum(['official', 'user_override']),
  })
  .refine((e) => e.effectiveTo === null || Date.parse(e.effectiveTo) > Date.parse(e.effectiveFrom), {
    message: 'effectiveTo must be after effectiveFrom',
    path: ['effectiveTo'],
  });

/** Returns a message for the first overlapping same-model+source pair, else null. */
function findOverlap(entries: RateEntry[]): string | null {
  const groups = new Map<string, RateEntry[]>();
  for (const e of entries) {
    const k = `${e.source}\u0000${e.modelId.toLowerCase()}`;
    const g = groups.get(k);
    if (g) g.push(e);
    else groups.set(k, [e]);
  }
  for (const g of groups.values()) {
    const s = [...g].sort((a, b) => Date.parse(a.effectiveFrom) - Date.parse(b.effectiveFrom));
    for (let i = 1; i < s.length; i++) {
      const prev = s[i - 1] as RateEntry;
      const cur = s[i] as RateEntry;
      if (prev.effectiveTo === null || Date.parse(prev.effectiveTo) > Date.parse(cur.effectiveFrom)) {
        return `overlapping intervals for ${cur.modelId} (${cur.source})`;
      }
    }
  }
  return null;
}

export const rateEntriesSchema = z.array(rateEntrySchema).superRefine((entries, ctx) => {
  const msg = findOverlap(entries as RateEntry[]);
  if (msg) ctx.addIssue({ code: z.ZodIssueCode.custom, message: msg });
});

export const rateScheduleSchema = z.object({
  version: z.string().min(1).max(128),
  sourceUrl: z.string().min(1),
  lastVerified: z.string().min(1),
  currency: z.literal('USD'),
  notModeled: z.array(z.string()),
  entries: rateEntriesSchema,
});

/** Tiny FNV-1a 32-bit hash (browser-safe), 8 hex chars. */
export function fnv1a8(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v);
  }
  return o;
}

let cached: RateSchedule | null = null;
/** The bundled official schedule (validated once, deep-frozen). */
export function getDefaultSchedule(): RateSchedule {
  if (!cached) {
    cached = deepFreeze(rateScheduleSchema.parse(structuredClone(defaultJson)) as RateSchedule);
  }
  return cached;
}

/**
 * Combine official schedule with validated user overrides. With overrides the
 * version becomes `${official.version}+local-<hash8>`; overrides are forced to
 * source 'user_override'. Throws ZodError on invalid/overlapping overrides.
 */
export function mergeSchedules(official: RateSchedule, overrides: RateEntry[]): RateSchedule {
  if (overrides.length === 0) return official;
  const forced = overrides.map((o) => ({ ...o, source: 'user_override' as const }));
  const valid = rateEntriesSchema.parse(forced) as RateEntry[];
  const hash = fnv1a8(JSON.stringify(valid));
  return {
    ...official,
    version: `${official.version}+local-${hash}`,
    entries: [...valid, ...official.entries],
  };
}
