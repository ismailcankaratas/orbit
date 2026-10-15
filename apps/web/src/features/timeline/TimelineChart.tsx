import { useMemo, type MouseEvent } from 'react';
import type { TimelineDTO, TimelineInterval } from '@orbit/core';
import { addDays, dayStartIso } from '../../api/dates';
import { useFormat, useT } from '../../i18n';

export const VIEW_W = 1000;
export const LABEL_W = 168;
const PAD_R = 12;
const PLOT_W = VIEW_W - LABEL_W - PAD_R;
const ROW_H = 26;
const BAR_H = 14;
const AXIS_H = 28;

export interface ActiveRef {
  lane: number;
  i: number;
}

export interface Tick {
  ms: number;
  label: string;
}

/** Ticks at local-midnight boundaries (days) or every 3 hours when the period is two days or shorter. */
export function makeTicks(fromMs: number, toMs: number, tz: string, fmt: { time: (iso: string) => string; day: (ymd: string, withYear?: boolean) => string }): Tick[] {
  const span = toMs - fromMs;
  const out: Tick[] = [];
  const startYmd = new Date(fromMs).toISOString().slice(0, 10);
  const days: string[] = [];
  for (let k = -1; k <= Math.ceil(span / 86_400_000) + 1 && days.length < 120; k++) days.push(addDays(startYmd, k));
  if (span <= 2 * 86_400_000) {
    for (const d of days) {
      const base = Date.parse(dayStartIso(d, tz));
      for (let h = 0; h < 24; h += 3) {
        const ms = base + h * 3_600_000;
        if (ms >= fromMs && ms <= toMs) out.push({ ms, label: fmt.time(new Date(ms).toISOString()) });
      }
    }
    return out;
  }
  const every = Math.max(1, Math.ceil(span / 86_400_000 / 8));
  let n = 0;
  for (const d of days) {
    const ms = Date.parse(dayStartIso(d, tz));
    if (ms < fromMs || ms > toMs) continue;
    if (n++ % every === 0) out.push({ ms, label: fmt.day(d) });
  }
  return out;
}

/** All interval rectangles live in ONE svg (no per-interval buttons); keyboard access is the paginated table. */
export function TimelineChart({ dto, active, onActive }: { dto: TimelineDTO; active: ActiveRef | null; onActive: (a: ActiveRef) => void }) {
  const t = useT();
  const fmt = useFormat();
  const fromMs = Date.parse(dto.period.from);
  const toMs = Date.parse(dto.period.to);
  const span = Math.max(1, toMs - fromMs);
  const x = (ms: number) => LABEL_W + Math.max(0, Math.min(1, (ms - fromMs) / span)) * PLOT_W;
  const height = AXIS_H + dto.lanes.length * ROW_H + 4;
  const ticks = useMemo(() => makeTicks(fromMs, toMs, dto.period.tz, fmt), [fromMs, toMs, dto.period.tz, fmt]);

  const rects = useMemo(
    () =>
      dto.lanes.map((lane, li) =>
        lane.intervals.map((iv, i) => {
          const x0 = x(Date.parse(iv.start));
          const x1 = x(Date.parse(iv.end));
          const w = Math.max(2, Math.min(x1 - x0, VIEW_W - PAD_R - x0));
          return <rect key={i} data-l={li} data-i={i} x={x0} y={AXIS_H + li * ROW_H + (ROW_H - BAR_H) / 2} width={w} height={BAR_H} rx="2" className="tl-iv" />;
        }),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dto, fromMs, span],
  );

  const pick = (e: MouseEvent<SVGSVGElement>) => {
    const el = e.target as SVGElement;
    const l = el.getAttribute?.('data-l');
    const i = el.getAttribute?.('data-i');
    if (l === null || i === null || l === undefined || i === undefined) return null;
    return { lane: Number(l), i: Number(i) };
  };
  const activeLane = active ? dto.lanes[active.lane] : undefined;
  const activeIv: TimelineInterval | undefined = activeLane?.intervals[active?.i ?? -1];

  return (
    <div className="graph-scroll">
      <svg
        className="tl-svg"
        viewBox={`0 0 ${VIEW_W} ${height}`}
        role="img"
        aria-label={t('timeline.chartLabel', { lanes: dto.lanes.length, count: dto.lanes.reduce((a, l) => a + l.intervals.length, 0) })}
        onMouseOver={(e) => { const p = pick(e); if (p) onActive(p); }}
        onClick={(e) => { const p = pick(e); if (p) onActive(p); }}
      >
        {ticks.map((tk) => (
          <g key={tk.ms} aria-hidden="true">
            <line x1={x(tk.ms)} x2={x(tk.ms)} y1={AXIS_H - 6} y2={height} stroke="var(--line)" />
            <text x={x(tk.ms) + 3} y={AXIS_H - 10} fontSize="11" fill="var(--text-secondary)">{tk.label}</text>
          </g>
        ))}
        {dto.lanes.map((lane, li) => (
          <g key={lane.id} aria-hidden="true">
            {li % 2 === 0 ? <rect x="0" y={AXIS_H + li * ROW_H} width={VIEW_W} height={ROW_H} fill="rgba(255,255,255,.025)" /> : null}
            <text x="6" y={AXIS_H + li * ROW_H + ROW_H / 2 + 4} fontSize="12" fill="var(--text-primary)">{lane.label.length > 24 ? `${lane.label.slice(0, 23)}…` : lane.label}</text>
            <title>{lane.label}</title>
          </g>
        ))}
        <g>{rects}</g>
        {active && activeIv ? (
          <rect x={x(Date.parse(activeIv.start)) - 2} y={AXIS_H + active.lane * ROW_H + (ROW_H - BAR_H) / 2 - 2} width={Math.max(2, x(Date.parse(activeIv.end)) - x(Date.parse(activeIv.start))) + 4} height={BAR_H + 4} rx="3" fill="none" stroke="var(--focus)" strokeWidth="2" pointerEvents="none" />
        ) : null}
      </svg>
    </div>
  );
}
