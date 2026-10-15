import type { CostsDTO, Coverage, CostSummary, StoryDTO, TimelineDTO, TokenTotals } from '@orbit/core';

export const tokens: TokenTotals = { uncachedInput: 1000, output: 500, cacheRead: 8000, cacheWrite5m: 400, cacheWrite1h: 100, unsplitCacheWrite: 0, processed: 10000 };
export const period = { from: '2026-09-16T00:00:00.000Z', to: '2026-10-16T00:00:00.000Z', tz: 'Europe/Istanbul' };

export const cost = (over: Partial<CostSummary> = {}): CostSummary => ({
  usdDecimal: '12.345600',
  quality: 'estimated',
  reason: 'x',
  rateScheduleVersion: 'anthropic-2026-10-15',
  pricedRequestCount: 90,
  fallbackPricedRequestCount: 0,
  unpricedRequestCount: 10,
  unpricedTokens: 500,
  unpricedModels: ['claude-mystery-9'],
  requestCoverage: 0.9,
  tokenCoverage: 0.95,
  ...over,
});

export const coverage: Coverage = { sourceFirstAt: '2026-09-20T10:00:00Z', sourceLastAt: '2026-10-14T10:00:00Z', uniqueRequests: 100, unpricedRequestCount: 10, fallbackPricedRequestCount: 0, unlinkedAgentCount: 0, malformedLineCount: 0, archivedOnlyRequestCount: 0, sourceStatus: 'complete' };

export function storyDto(over: { mode?: 'demo' | 'real'; empty?: boolean } = {}): StoryDTO {
  const empty = over.empty ?? false;
  const t: TokenTotals = empty ? { uncachedInput: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, unsplitCacheWrite: 0, processed: 0 } : tokens;
  const daily = ['2026-10-12', '2026-10-13', '2026-10-14'].map((date, i) => ({ date, uniqueRequests: empty ? 0 : 10 + i, tokens: { ...t, processed: empty ? 0 : 1000 * (i + 1) }, usdDecimal: '1.000000', unpricedRequests: 0, sessions: 1 }));
  return {
    period,
    mode: over.mode ?? 'real',
    overview: {
      kpis: {
        uniqueRequests: { value: empty ? 0 : 100, quality: 'observed' },
        tokens: { ...t, quality: 'observed' },
        cost: cost(empty ? { usdDecimal: '0.000000', pricedRequestCount: 0, unpricedRequestCount: 0, unpricedModels: [], requestCoverage: 1, tokenCoverage: 1 } : {}),
        sessions: { value: empty ? 0 : 7, quality: 'observed' },
        projects: { value: empty ? 0 : 2, quality: 'observed' },
        subagents: { value: empty ? 0 : 3, quality: 'observed' },
      },
      daily: empty ? [] : daily,
      models: empty ? [] : [
        { modelId: 'claude-sonnet-5', displayName: 'Claude Sonnet 5', requests: 80, tokens: { ...t, processed: 8000 }, usdDecimal: '10.000000', priced: true },
        { modelId: 'claude-mystery-9', displayName: null, requests: 20, tokens: { ...t, processed: 2000 }, usdDecimal: null, priced: false },
      ],
      topProjects: empty ? [] : [{ id: 'p_aaaaaaaaaaaa', alias: null, label: 'demo-app', shortCode: 'ab12', nameCollision: false, sessions: 5, requests: 70, agents: 2, tokens: { ...t, processed: 7000 }, usdDecimal: '8.000000', unpricedRequests: 0, lastActiveAt: '2026-10-14T10:00:00Z', trend: [1, 2, 3], sourcePresent: true }],
      coverage: empty ? { ...coverage, uniqueRequests: 0, unpricedRequestCount: 0, sourceStatus: 'empty' } : coverage,
      insights: [],
    },
    delegation: { mainRequests: empty ? 0 : 70, agentRequests: empty ? 0 : 30, agentShare: empty ? 0 : 0.3, topRoles: empty ? [] : [{ role: 'reviewer', requests: 20 }], byConfidence: { exact: 2, inferred: 1, unlinked: 0, unknown: 0 } },
    cache: { cacheReadShare: empty ? 0 : 0.8, cacheWriteShare: empty ? 0 : 0.05, uncachedInputShare: empty ? 0 : 0.1 },
    schedule: { version: 'anthropic-2026-10-15', sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing', lastVerified: '2026-10-15', notModeled: ['Batch API discount', 'Fast mode premium pricing'], overrideCount: 0 },
  };
}

export function costsDto(): CostsDTO {
  const rate = { input: '3', output: '15', cacheRead: '0.3', cacheWrite5m: '3.75', cacheWrite1h: '6' };
  return {
    period,
    cost: cost(),
    byModel: [
      { modelId: 'claude-sonnet-5', displayName: 'Claude Sonnet 5', requests: 80, tokens: { ...tokens, processed: 8000 }, usdDecimal: '10.000000', priced: true, rate, rateSource: 'official' },
      { modelId: 'claude-local-1', displayName: 'Local One', requests: 5, tokens: { ...tokens, processed: 500 }, usdDecimal: '1.000000', priced: true, rate, rateSource: 'user_override' },
      { modelId: 'claude-mystery-9', displayName: null, requests: 20, tokens: { ...tokens, processed: 2000 }, usdDecimal: null, priced: false, rate: null, rateSource: null },
    ],
    byCategory: {
      uncachedInput: { tokens: 1000, usdDecimal: '0.003000' },
      output: { tokens: 500, usdDecimal: '0.007500' },
      cacheRead: { tokens: 8000, usdDecimal: '0.002400' },
      cacheWrite5m: { tokens: 400, usdDecimal: '0.001500' },
      cacheWrite1h: { tokens: 100, usdDecimal: '0.000600' },
      unsplitCacheWrite: { tokens: 50, usdDecimal: '0.000187' },
    },
    daily: [{ date: '2026-10-14', uniqueRequests: 10, tokens, usdDecimal: '1.000000', unpricedRequests: 1, sessions: 1 }],
    unpriced: [{ modelId: 'claude-mystery-9', requests: 20, tokens: 2000 }],
    schedule: { version: 'anthropic-2026-10-15+local-abc12345', sourceUrl: 'https://platform.claude.com/docs/en/about-claude/pricing', lastVerified: '2026-10-15', notModeled: ['Batch API discount'], overrideCount: 1 },
  };
}

export function timelineDto(intervals: number, lanes = 5): TimelineDTO {
  const from = Date.parse(period.from);
  const span = Date.parse(period.to) - from;
  return {
    period,
    groupBy: 'project',
    truncated: false,
    lanes: Array.from({ length: lanes }, (_, l) => ({
      id: `p_${l}`,
      label: `lane-${l}`,
      kind: 'project' as const,
      intervals: Array.from({ length: Math.floor(intervals / lanes) }, (_, i) => {
        const start = from + Math.floor((i / (intervals / lanes)) * span * 0.98);
        return { start: new Date(start).toISOString(), end: new Date(start + 600_000).toISOString(), sessionId: `s_${l}_${i}`, agentId: null, requests: 3, processed: 1234 };
      }),
    })),
  };
}
