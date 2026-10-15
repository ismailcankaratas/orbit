import type { ModelSlice, ProjectSummary } from '@orbit/core';

/** Pure view-model helpers for the Merkez orbit (no React). All numbers come from API DTOs. */

export const VB = 600;
export const CX = VB / 2;
export const CY = VB / 2;
export const SUN_R = 56;
export const MODEL_R = 90;
export const MODEL_W = 14;
export const MAX_PLANETS = 8;

export const PALETTE = ['var(--accent)', 'var(--teal)', 'var(--violet)', 'var(--coral)', 'var(--green)', '#c9b79a', '#8fa9d6', '#d6a0b8'] as const;

export function polar(r: number, deg: number): { x: number; y: number } {
  const a = (deg * Math.PI) / 180;
  return { x: CX + r * Math.sin(a), y: CY - r * Math.cos(a) };
}

export function arcPath(r: number, a0: number, a1: number): string {
  const s = polar(r, a0);
  const e = polar(r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

export interface ModelArc {
  key: string;
  model: ModelSlice;
  share: number;
  a0: number;
  a1: number;
  color: string;
  unpriced: boolean;
}

/** Arc length proportional to processed-token share; tiny shares get a minimum visual sweep. */
export function buildModelArcs(models: ModelSlice[]): ModelArc[] {
  const sorted = [...models].filter((m) => m.tokens.processed > 0).sort((a, b) => b.tokens.processed - a.tokens.processed);
  const total = sorted.reduce((s, m) => s + m.tokens.processed, 0);
  if (!total) return [];
  const gap = sorted.length > 1 ? 3 : 0;
  const minSweep = 4;
  const raw = sorted.map((m) => Math.max(minSweep, (m.tokens.processed / total) * (360 - gap * sorted.length)));
  const scale = (360 - gap * sorted.length) / raw.reduce((s, v) => s + v, 0);
  let cursor = gap / 2;
  return sorted.map((m, i) => {
    const sweep = (raw[i] as number) * scale;
    const arc: ModelArc = {
      key: `m:${m.modelId}`,
      model: m,
      share: m.tokens.processed / total,
      a0: cursor,
      a1: cursor + sweep,
      color: PALETTE[i % PALETTE.length] as string,
      unpriced: !m.priced,
    };
    cursor += sweep + gap;
    return arc;
  });
}

export interface Planet {
  key: string;
  project: ProjectSummary;
  share: number;
  orbitR: number;
  angle: number;
  r: number;
  color: string;
  durationS: number;
}

export interface RestCluster {
  key: 'rest';
  count: number;
  tokens: number;
  share: number;
  sessions: number;
  requests: number;
  agents: number;
  orbitR: number;
  angle: number;
}

export interface OrbitModel {
  planets: Planet[];
  rest: RestCluster | null;
}

const GOLDEN = 137.508;

export function buildPlanets(projects: ProjectSummary[], totalTokens: number): OrbitModel {
  const sorted = [...projects].sort((a, b) => b.tokens.processed - a.tokens.processed || a.id.localeCompare(b.id));
  const top = sorted.slice(0, MAX_PLANETS);
  const tail = sorted.slice(MAX_PLANETS);
  const slots = top.length + (tail.length ? 1 : 0);
  const inner = 124;
  const outer = 262;
  const step = slots > 1 ? Math.min(26, (outer - inner) / (slots - 1)) : 0;
  const max = Math.max(1, ...top.map((p) => p.tokens.processed));
  const denom = totalTokens > 0 ? totalTokens : sorted.reduce((s, p) => s + p.tokens.processed, 0) || 1;
  const planets = top.map((p, i): Planet => ({
    key: `p:${p.id}`,
    project: p,
    share: p.tokens.processed / denom,
    orbitR: inner + i * step,
    angle: (i * GOLDEN + 20) % 360,
    r: Math.min(21, Math.max(7, 7 + 14 * Math.sqrt(p.tokens.processed / max))),
    color: PALETTE[i % PALETTE.length] as string,
    durationS: 120 + i * 18,
  }));
  let rest: RestCluster | null = null;
  if (tail.length) {
    const tokens = tail.reduce((s, p) => s + p.tokens.processed, 0);
    rest = {
      key: 'rest',
      count: tail.length,
      tokens,
      share: tokens / denom,
      sessions: tail.reduce((s, p) => s + p.sessions, 0),
      requests: tail.reduce((s, p) => s + p.requests, 0),
      agents: tail.reduce((s, p) => s + p.agents, 0),
      orbitR: inner + top.length * step,
      angle: (top.length * GOLDEN + 20) % 360,
    };
  }
  return { planets, rest };
}

/** Deterministic tiny star field (no Math.random: stable between renders and tests). */
export function stars(n: number): { x: number; y: number; r: number; o: number }[] {
  const out: { x: number; y: number; r: number; o: number }[] = [];
  let s = 7;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  for (let i = 0; i < n; i++) out.push({ x: rnd() * VB, y: rnd() * VB, r: 0.4 + rnd() * 0.9, o: 0.15 + rnd() * 0.45 });
  return out;
}

export function daysInRange(from: string, to: string): number {
  const p = (s: string) => {
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  };
  return Math.max(1, Math.round((p(to) - p(from)) / 86_400_000) + 1);
}

export function pctChange(cur: number, prev: number): number | null {
  if (!Number.isFinite(cur) || !Number.isFinite(prev) || prev <= 0) return null;
  return (cur - prev) / prev;
}
