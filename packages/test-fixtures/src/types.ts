/** Expected normalized totals for a generated tree. `null` = not asserted. */
export type ExpectedTotals = {
  uniqueRequests: number | null;
  uncachedInput: number | null;
  output: number | null;
  cacheRead: number | null;
  cacheWrite5m: number | null;
  cacheWrite1h: number | null;
  unsplitCacheWrite: number | null;
  exactLinks: number | null;
  inferredLinks: number | null;
  unlinkedAgents: number | null;
  unknownModelRequests: number | null;
  malformedLines: number | null;
  projects: number | null;
  sessions: number | null;
};

export const TOTAL_KEYS: ReadonlyArray<keyof ExpectedTotals> = [
  'uniqueRequests',
  'uncachedInput',
  'output',
  'cacheRead',
  'cacheWrite5m',
  'cacheWrite1h',
  'unsplitCacheWrite',
  'exactLinks',
  'inferredLinks',
  'unlinkedAgents',
  'unknownModelRequests',
  'malformedLines',
  'projects',
  'sessions',
];

export type Scenario = {
  name: string;
  description: string;
  build(root: string): Promise<void>;
  expected: ExpectedTotals;
  /** Optional local-day request counts per IANA timezone (DST scenario). */
  daily?: Record<string, Record<string, number>>;
};

export function sumTotals(list: ExpectedTotals[]): ExpectedTotals {
  const out = {} as Record<string, number | null>;
  for (const k of TOTAL_KEYS) {
    let acc: number | null = 0;
    for (const t of list) {
      const v = t[k];
      if (v === null || acc === null) acc = null;
      else acc += v;
    }
    out[k] = acc;
  }
  return out as ExpectedTotals;
}
