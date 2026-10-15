import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import type { AgentsDTO, Page, ProjectSummary } from '@orbit/core';
import { mockFetch, renderWith } from '../test/utils';
import { Agents } from './agents/Agents';
import { Projects } from './projects/Projects';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const tokens = { uncachedInput: 10, output: 5, cacheRead: 100, cacheWrite5m: 4, cacheWrite1h: 0, unsplitCacheWrite: 0, processed: 119 };
const period = { from: '2026-09-16T00:00:00.000Z', to: '2026-10-16T00:00:00.000Z', tz: 'Europe/Istanbul' };

const agentsDto: AgentsDTO = {
  items: [
    { id: 'a1', shortId: 'a1b2c3', role: 'frontend-engineer', projectId: 'p1', projectLabel: 'demo-app', sessionId: 's1', parentAgentId: null, depth: 1, confidence: 'exact', linkReason: 'meta_tool_use_id_match', status: 'observed_recently', firstAt: '2026-10-14T10:00:00Z', lastAt: '2026-10-14T11:00:00Z', requests: 4, models: ['claude-sonnet-5'], tokens, usdDecimal: '0.120000', unpricedRequests: 0 },
    { id: 'a2', shortId: 'd4e5f6', role: null, projectId: null, projectLabel: null, sessionId: null, parentAgentId: null, depth: null, confidence: 'unlinked', linkReason: 'no_parent_found', status: 'historical', firstAt: null, lastAt: null, requests: 1, models: [], tokens, usdDecimal: '0.000000', unpricedRequests: 1 },
  ],
  total: 2,
  nextCursor: null,
  period,
  graph: {
    nodes: [
      { id: 's1', kind: 'session', label: 's1x', role: null, projectId: 'p1', processed: 500, status: null, orphan: false },
      { id: 'a1', kind: 'agent', label: 'a1', role: 'frontend-engineer', projectId: 'p1', processed: 119, status: 'observed_recently', orphan: false },
      { id: 'a2', kind: 'agent', label: 'a2', role: null, projectId: null, processed: 119, status: 'historical', orphan: true },
    ],
    edges: [{ from: 's1', to: 'a1', confidence: 'exact' }],
    truncated: false,
  },
  totals: { byConfidence: { exact: 1, inferred: 0, unlinked: 1, unknown: 0 }, byStatus: { observed_recently: 1, historical: 1, unknown: 0, completed_recorded: 0 }, tokens, usdDecimal: '0.120000' },
  roles: ['frontend-engineer'],
};

describe('Agents page', () => {
  it('is read-only: renders no agent-control buttons', async () => {
    mockFetch({ '/api/v1/agents': agentsDto });
    renderWith(<Agents />, { route: '/agents' });
    await waitFor(() => expect(screen.getAllByText(/frontend-engineer/).length).toBeGreaterThan(0));
    const bad = /\b(ata|görevi ata|duraklat|durdur|yeniden başlat|assign|pause|stop|restart)\b/i;
    for (const b of [...screen.getAllByRole('button'), ...screen.queryAllByRole('link')]) {
      expect(`${b.textContent} ${b.getAttribute('aria-label') ?? ''}`).not.toMatch(bad);
    }
    // status wording never claims liveness
    expect(document.body.textContent).toContain('yakın zamanda gözlendi');
    expect(document.body.textContent).not.toMatch(/çalışıyor|running/i);
  });
});

describe('XSS safety', () => {
  it('renders hostile project labels as text, never as elements', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    const page: Page<ProjectSummary> = {
      items: [{ id: 'p1', alias: null, label: evil, shortCode: 'ab12', nameCollision: false, sessions: 1, requests: 2, agents: 0, tokens, usdDecimal: '0.010000', unpricedRequests: 0, lastActiveAt: '2026-10-14T10:00:00Z', trend: [1, 2, 3], sourcePresent: true }],
      total: 1,
      nextCursor: null,
    };
    mockFetch({ '/api/v1/projects': page });
    const { container } = renderWith(<Projects />, { route: '/projects' });
    await waitFor(() => expect(screen.getAllByText(evil).length).toBeGreaterThan(0));
    expect(container.querySelector('img')).toBeNull();
  });
});
