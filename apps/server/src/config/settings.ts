import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { mergeSchedules, getDefaultSchedule, rateEntriesSchema, type RateEntry, type RateSchedule } from '@orbit/core';

export const DEFAULT_TIMEZONE = 'Europe/Istanbul';

export interface StoredSettings {
  consentGranted: boolean;
  /** Canonical absolute path chosen by the user; null = default root. Never serialized to HTTP. */
  sourceRoot: string | null;
  archiveEnabled: boolean;
  watchIntervalMs: number;
  locale: 'tr' | 'en';
  timezone: string;
  activeDataset: 'real' | 'demo';
  rateOverrides: RateEntry[];
}

export const DEFAULT_SETTINGS: StoredSettings = {
  consentGranted: false,
  sourceRoot: null,
  archiveEnabled: false,
  watchIntervalMs: 5000,
  locale: 'tr',
  timezone: DEFAULT_TIMEZONE,
  activeDataset: 'real',
  rateOverrides: [],
};

export function isValidTimezone(tz: string): boolean {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const tzSchema = z.string().refine(isValidTimezone, 'invalid timezone');

export const patchSchema = z
  .object({
    consentGranted: z.boolean(),
    sourceRoot: z.string().min(1).max(4096),
    archiveEnabled: z.boolean(),
    watchIntervalMs: z.number().int().min(2000).max(60000),
    locale: z.enum(['tr', 'en']),
    timezone: tzSchema,
    activeDataset: z.enum(['real', 'demo']),
    rateOverrides: z.array(z.unknown()).max(100),
  })
  .partial()
  .strict();

const storedSchema = z.object({
  consentGranted: z.boolean().catch(false),
  sourceRoot: z.string().nullable().catch(null),
  archiveEnabled: z.boolean().catch(false),
  watchIntervalMs: z.number().int().min(2000).max(60000).catch(5000),
  locale: z.enum(['tr', 'en']).catch('tr'),
  timezone: tzSchema.catch(DEFAULT_TIMEZONE),
  activeDataset: z.enum(['real', 'demo']).catch('real'),
  rateOverrides: z.unknown().catch([]),
});

export function validateRateOverrides(input: unknown): RateEntry[] {
  const parsed = rateEntriesSchema.parse(input) as RateEntry[];
  mergeSchedules(getDefaultSchedule(), parsed); // throws on invalid/overlap
  return parsed.map((e) => ({ ...e, source: 'user_override' as const }));
}

export class SettingsStore {
  private current: StoredSettings;
  private readonly file: string;

  constructor(dataDir: string) {
    this.file = join(dataDir, 'settings.json');
    this.current = this.load();
  }

  private load(): StoredSettings {
    if (!existsSync(this.file)) return { ...DEFAULT_SETTINGS };
    try {
      const raw = storedSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')));
      let overrides: RateEntry[] = [];
      try {
        overrides = validateRateOverrides(raw.rateOverrides ?? []);
      } catch {
        overrides = [];
      }
      return { ...raw, rateOverrides: overrides };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  get(): StoredSettings {
    return this.current;
  }

  update(patch: Partial<StoredSettings>): StoredSettings {
    this.current = { ...this.current, ...patch };
    const tmp = this.file + '.tmp';
    writeFileSync(tmp, JSON.stringify(this.current), { mode: 0o600 });
    renameSync(tmp, this.file);
    try {
      chmodSync(this.file, 0o600);
    } catch {
      /* best effort */
    }
    return this.current;
  }

  schedule(): RateSchedule {
    return mergeSchedules(getDefaultSchedule(), this.current.rateOverrides);
  }
}
