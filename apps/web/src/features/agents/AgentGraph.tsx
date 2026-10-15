import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { AgentGraphEdge, AgentGraphNode, LinkConfidence } from '@orbit/core';
import { useFormat, useT } from '../../i18n';

/** Layout constants (SVG user units). */
export const W = 1200;
const COLS = 6;
const CELL_H = 184;
const TOP = 8;
export const MAX_SESSIONS = 24;
const MAX_AGENTS_PER_HUB = 16;
const RING = [46, 70];
const RING_CAP = [8, 8];
const LABEL_DY = 92;
const ORPHAN_PER_ROW = 40;
const MAX_ORPHANS = 80;
const TOP_LABELLED = 6;

export interface PlacedNode extends AgentGraphNode {
  x: number;
  y: number;
  r: number;
  hub: string | null;
}
export interface PlacedEdge { from: string; to: string; confidence: LinkConfidence }
export interface GraphLayout {
  hubs: PlacedNode[];
  agents: PlacedNode[];
  orphans: PlacedNode[];
  edges: PlacedEdge[];
  /** sessions that did not make the top-N cut */
  hiddenSessions: number;
  /** agents of shown sessions that did not fit around their hub */
  hiddenAgents: number;
  hiddenOrphans: number;
  /** extra agent count per shown hub (not drawn) */
  extra: Map<string, number>;
  height: number;
  orphanTop: number;
}

/** Pure layout: sessions become hubs on a centre-weighted grid (busiest in the middle), agents are fanned in rings around their hub. */
export function layoutGraph(nodes: AgentGraphNode[], edges: AgentGraphEdge[]): GraphLayout {
  const sessions = nodes.filter((n) => n.kind === 'session');
  const agentNodes = nodes.filter((n) => n.kind === 'agent');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parent = new Map<string, string>();
  for (const e of edges) if (!parent.has(e.to)) parent.set(e.to, e.from);
  const rootOf = (id: string): string | null => {
    let cur = id;
    for (let i = 0; i < 8; i++) {
      const p = parent.get(cur);
      if (!p) return null;
      if (byId.get(p)?.kind === 'session') return p;
      cur = p;
    }
    return null;
  };
  const depthOf = (id: string): number => {
    let d = 0;
    let cur = id;
    for (let i = 0; i < 8; i++) {
      const p = parent.get(cur);
      if (!p || byId.get(p)?.kind === 'session') return d;
      d += 1;
      cur = p;
    }
    return d;
  };

  const children = new Map<string, AgentGraphNode[]>();
  const orphanList: AgentGraphNode[] = [];
  for (const a of agentNodes) {
    if (a.orphan) {
      orphanList.push(a);
      continue;
    }
    const r = rootOf(a.id);
    if (!r) continue;
    const arr = children.get(r) ?? [];
    arr.push(a);
    children.set(r, arr);
  }
  const activity = (s: AgentGraphNode) => s.processed + (children.get(s.id) ?? []).reduce((a, c) => a + c.processed, 0);
  const ranked = [...sessions].sort((a, b) => activity(b) - activity(a) || a.id.localeCompare(b.id));
  const shown = ranked.slice(0, MAX_SESSIONS);
  const cols = Math.max(1, Math.min(COLS, shown.length));
  const rows = Math.max(1, Math.ceil(shown.length / cols));
  const cellW = W / cols;
  const cells: { cx: number; cy: number; d: number }[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const cx = (c + 0.5) * cellW;
      const cy = TOP + (r + 0.5) * CELL_H - 8;
      const dx = (c - (cols - 1) / 2) * 0.8;
      const dy = r - (rows - 1) / 2;
      cells.push({ cx, cy, d: dx * dx + dy * dy });
    }
  cells.sort((a, b) => a.d - b.d || a.cy - b.cy || a.cx - b.cx);

  const maxAct = Math.max(1, ...shown.map(activity));
  const allShownAgents = shown.flatMap((s) => children.get(s.id) ?? []);
  const maxP = Math.max(1, ...allShownAgents.map((a) => a.processed), ...orphanList.map((a) => a.processed));
  const agentR = (p: number) => 3.5 + 4.5 * Math.sqrt(p / maxP);

  const hubs: PlacedNode[] = [];
  const agents: PlacedNode[] = [];
  const extra = new Map<string, number>();
  let hiddenAgents = 0;
  shown.forEach((s, i) => {
    const cell = cells[i] as { cx: number; cy: number };
    hubs.push({ ...s, x: cell.cx, y: cell.cy, r: 10 + 6 * Math.sqrt(activity(s) / maxAct), hub: null });
    const kids = [...(children.get(s.id) ?? [])].sort((a, b) => depthOf(a.id) - depthOf(b.id) || b.processed - a.processed || a.id.localeCompare(b.id));
    const fit = kids.slice(0, MAX_AGENTS_PER_HUB);
    if (kids.length > fit.length) {
      extra.set(s.id, kids.length - fit.length);
      hiddenAgents += kids.length - fit.length;
    }
    let idx = 0;
    RING.forEach((radius, ri) => {
      const take = fit.slice(idx, idx + (RING_CAP[ri] as number));
      idx += take.length;
      take.forEach((a, k) => {
        const ang = ((k + (ri ? 0.5 : 0)) / Math.max(1, take.length)) * Math.PI * 2 - Math.PI / 2;
        agents.push({ ...a, x: cell.cx + Math.cos(ang) * radius, y: cell.cy + Math.sin(ang) * radius, r: agentR(a.processed), hub: s.id });
      });
    });
  });

  const placed = new Set([...hubs, ...agents].map((n) => n.id));
  const keptEdges = edges.filter((e) => placed.has(e.from) && placed.has(e.to));
  const orphanTop = TOP + rows * CELL_H + 16;
  const orphanSorted = [...orphanList].sort((a, b) => b.processed - a.processed || a.id.localeCompare(b.id));
  const orphans = orphanSorted.slice(0, MAX_ORPHANS).map((o, i) => ({
    ...o,
    x: 40 + ((i % ORPHAN_PER_ROW) + 0.5) * ((W - 80) / ORPHAN_PER_ROW),
    y: orphanTop + 38 + Math.floor(i / ORPHAN_PER_ROW) * 28,
    r: Math.min(8, agentR(o.processed)),
    hub: null,
  }));
  const height = orphanList.length ? orphanTop + 38 + Math.max(1, Math.ceil(orphans.length / ORPHAN_PER_ROW)) * 28 + 4 : TOP + rows * CELL_H + 4;
  return { hubs, agents, orphans, edges: keptEdges, hiddenSessions: Math.max(0, sessions.length - shown.length), hiddenAgents, hiddenOrphans: Math.max(0, orphanList.length - orphans.length), extra, height, orphanTop };
}

const edgeStroke = (c: LinkConfidence) => (c === 'exact' ? 'var(--green)' : c === 'inferred' ? 'var(--warning)' : 'var(--line-strong)');
const edgeDash = (c: LinkConfidence) => (c === 'exact' ? undefined : c === 'inferred' ? '7 5' : '2 5');

export function AgentGraph({ nodes, edges, truncated, onNode, onShowList }: { nodes: AgentGraphNode[]; edges: AgentGraphEdge[]; truncated: boolean; onNode: (n: AgentGraphNode) => void; onShowList?: () => void }) {
  const t = useT();
  const fmt = useFormat();
  const L = useMemo(() => layoutGraph(nodes, edges), [nodes, edges]);
  const order = useMemo(() => {
    const out: PlacedNode[] = [];
    for (const h of L.hubs) {
      out.push(h);
      for (const a of L.agents) if (a.hub === h.id) out.push(a);
    }
    return [...out, ...L.orphans];
  }, [L]);
  const pos = useMemo(() => new Map([...L.hubs, ...L.agents, ...L.orphans].map((n) => [n.id, n])), [L]);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const tabbable = order.some((n) => n.id === focusId) ? focusId : (order[0]?.id ?? null);
  const activeId = hoverId ?? focusId;
  const active = activeId ? pos.get(activeId) : undefined;

  const nodeName = (n: AgentGraphNode) => (n.kind === 'session' ? n.label : n.role ?? t('agent.roleUnknown'));
  const nodeLabel = (n: AgentGraphNode) =>
    n.kind === 'session' ? t('graph.sessionNode', { name: n.label, tokens: fmt.compact(n.processed) }) : t('graph.agentNode', { name: n.role ?? t('agent.roleUnknown'), tokens: fmt.compact(n.processed) });

  const moveTo = (id: string) => {
    setFocusId(id);
    svgRef.current?.querySelector<SVGGElement>(`[data-nid="${CSS.escape(id)}"]`)?.focus();
  };
  const onKey = (n: PlacedNode, i: number) => (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onNode(n);
      return;
    }
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'Home' ? -Infinity : e.key === 'End' ? Infinity : 0;
    if (!step) return;
    e.preventDefault();
    const j = step === Infinity ? order.length - 1 : step === -Infinity ? 0 : Math.max(0, Math.min(order.length - 1, i + step));
    const next = order[j];
    if (next) moveTo(next.id);
  };

  const hubLabelled = new Set(L.hubs.slice(0, TOP_LABELLED).map((h) => h.id));
  const renderNode = (n: PlacedNode, i: number) => {
    const isHub = n.kind === 'session';
    return (
      <g
        key={n.id}
        className={`node${n.id === activeId ? ' active' : ''}`}
        data-nid={n.id}
        role="button"
        tabIndex={n.id === tabbable ? 0 : -1}
        aria-label={nodeLabel(n)}
        onClick={() => onNode(n)}
        onKeyDown={onKey(n, i)}
        onFocus={() => setFocusId(n.id)}
        onMouseEnter={() => setHoverId(n.id)}
        onMouseLeave={() => setHoverId(null)}
      >
        <title>{nodeLabel(n)}</title>
        {/* enlarged transparent hit area for small nodes */}
        <circle cx={n.x} cy={n.y} r={Math.max(n.r + 4, 11)} fill="transparent" />
        {isHub ? (
          <rect className="node-ring" x={n.x - n.r} y={n.y - n.r} width={n.r * 2} height={n.r * 2} rx="3" transform={`rotate(45 ${n.x} ${n.y})`} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="2" />
        ) : n.orphan ? (
          <circle className="node-ring" cx={n.x} cy={n.y} r={n.r} fill="none" stroke="var(--text-secondary)" strokeWidth="1.6" strokeDasharray="3 3" />
        ) : (
          <circle className="node-ring" cx={n.x} cy={n.y} r={n.r} fill="var(--bg-raised)" stroke="var(--violet)" strokeWidth="1.6" />
        )}
      </g>
    );
  };

  return (
    <div>
      <div className="graph-scroll">
        <svg ref={svgRef} className="graph-svg" viewBox={`0 0 ${W} ${L.height}`} role="group" aria-label={t('graph.label')}>
          {L.edges.map((e, i) => {
            const a = pos.get(e.from);
            const b = pos.get(e.to);
            if (!a || !b) return null;
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={edgeStroke(e.confidence)} strokeWidth={e.confidence === 'exact' ? 1.4 : 1.2} strokeDasharray={edgeDash(e.confidence)} opacity=".75" />;
          })}
          {L.hubs.map((h) => (
            <g key={`lab-${h.id}`} aria-hidden="true" pointerEvents="none">
              {hubLabelled.has(h.id) ? <text x={h.x} y={h.y + LABEL_DY} textAnchor="middle" fontSize="12" fill="var(--text-secondary)">{nodeName(h).slice(0, 22)}</text> : null}
              {(L.extra.get(h.id) ?? 0) > 0 ? <text x={h.x} y={h.y + h.r + 14} textAnchor="middle" fontSize="11" fill="var(--text-secondary)" >+{L.extra.get(h.id)}</text> : null}
            </g>
          ))}
          {order.filter((n) => n.kind === 'session' || !n.orphan).map((n) => renderNode(n, order.indexOf(n)))}
          {L.orphans.length ? (
            <>
              <text x="40" y={L.orphanTop + 14} fontSize="13" fill="var(--text-secondary)">{t('graph.orphanGroup', { count: L.orphans.length + L.hiddenOrphans })}</text>
              <line x1="40" y1={L.orphanTop + 22} x2={W - 40} y2={L.orphanTop + 22} stroke="var(--line-strong)" strokeDasharray="1 5" />
              {L.orphans.map((n) => renderNode(n, order.indexOf(n)))}
            </>
          ) : null}
          {active ? (
            <g pointerEvents="none" aria-hidden="true">
              {(() => {
                const text = `${nodeName(active)} · ${fmt.compact(active.processed)}`;
                const w = Math.min(260, text.length * 7 + 18);
                const x = Math.max(w / 2 + 4, Math.min(W - w / 2 - 4, active.x));
                const y = Math.max(22, active.y - active.r - 12);
                return (
                  <>
                    <rect x={x - w / 2} y={y - 16} width={w} height={22} rx="6" fill="var(--bg-raised)" stroke="var(--line-strong)" />
                    <text x={x} y={y} textAnchor="middle" fontSize="12" fill="var(--text-primary)">{text.slice(0, 36)}</text>
                  </>
                );
              })()}
            </g>
          ) : null}
        </svg>
      </div>
      <ul className="legend" aria-label={t('graph.legend')}>
        <li><svg width="30" height="8" aria-hidden="true"><line x1="0" y1="4" x2="30" y2="4" stroke="var(--green)" strokeWidth="2" /></svg> {t('graph.legend.exact')}</li>
        <li><svg width="30" height="8" aria-hidden="true"><line x1="0" y1="4" x2="30" y2="4" stroke="var(--warning)" strokeWidth="2" strokeDasharray="7 5" /></svg> {t('graph.legend.inferred')}</li>
        <li><svg width="30" height="8" aria-hidden="true"><line x1="0" y1="4" x2="30" y2="4" stroke="var(--line-strong)" strokeWidth="2" strokeDasharray="2 5" /></svg> {t('graph.legend.unlinked')}</li>
        <li>◆ {t('graph.legend.session')}</li><li>● {t('graph.legend.agent')}</li><li>◌ {t('graph.legend.orphan')}</li>
      </ul>
      {L.hiddenSessions > 0 || L.hiddenAgents > 0 ? (
        <div className="notice" role="note">
          <span>
            {L.hiddenSessions > 0 ? t('graph.moreSessions', { count: L.hiddenSessions, max: MAX_SESSIONS }) : null}
            {L.hiddenSessions > 0 && L.hiddenAgents > 0 ? ' ' : null}
            {L.hiddenAgents > 0 ? t('graph.moreAgents', { count: L.hiddenAgents }) : null}
          </span>
          {onShowList ? <button type="button" className="btn sm" onClick={onShowList}>{t('graph.openList')}</button> : null}
        </div>
      ) : null}
      {truncated ? <p className="small muted">{t('graph.truncated')}</p> : null}
      <p className="small muted">{t('graph.note')}</p>
      <p className="small muted">{t('graph.keys')}</p>
    </div>
  );
}
