import { useId, useMemo, useRef, type KeyboardEvent } from 'react';
import { useFormat, useT } from '../../i18n';
import { CX, CY, MODEL_R, MODEL_W, SUN_R, VB, arcPath, polar, stars, type ModelArc, type OrbitModel } from './model';

export type SelectVia = 'pointer' | 'focus' | 'keyboard';

export interface OrbitProps {
  arcs: ModelArc[];
  orbit: OrbitModel;
  /** processed tokens for the sun label; null = no data (decorative empty orbit) */
  sunTokens: number | null;
  selectedKey: string | null;
  onSelect: (key: string, via: SelectVia) => void;
  /** ambient rotation allowed (scene active, tab visible, no reduced motion) */
  moving: boolean;
  decorative?: boolean;
}

export const projectName = (p: { alias: string | null; label: string }) => p.alias ?? p.label;

const STAR_FIELD = stars(46);
const orbitRings = (r: number) => <circle cx={CX} cy={CY} r={r} className="mz-ring" />;

export function Orbit({ arcs, orbit, sunTokens, selectedKey, onSelect, moving, decorative }: OrbitProps) {
  const t = useT();
  const fmt = useFormat();
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const ref = useRef<SVGSVGElement>(null);
  const order = useMemo(() => [...arcs.map((a) => a.key), ...orbit.planets.map((p) => p.key), ...(orbit.rest ? [orbit.rest.key] : [])], [arcs, orbit]);
  const focusable = selectedKey && order.includes(selectedKey) ? selectedKey : (order[0] ?? null);

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (decorative) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const target = (e.target as Element).closest('[data-mz-key]');
    if (!target || !ref.current?.contains(target) || order.length === 0) return;
    const cur = order.indexOf(target.getAttribute('data-mz-key') ?? '');
    const next = order[(Math.max(cur, 0) + (e.key === 'ArrowRight' ? 1 : order.length - 1)) % order.length] as string;
    e.preventDefault();
    e.stopPropagation(); // keep the shell's global chapter shortcuts from firing while navigating the orbit
    onSelect(next, 'keyboard');
    Array.from(ref.current.querySelectorAll<SVGElement>('[data-mz-key]')).find((el) => el.getAttribute('data-mz-key') === next)?.focus();
  };

  const activate = (e: KeyboardEvent<SVGGElement>, key: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(key, 'keyboard');
    }
  };

  const handlers = (key: string) => ({
    'data-mz-key': key,
    role: 'button' as const,
    tabIndex: focusable === key ? 0 : -1,
    'aria-pressed': selectedKey === key,
    onFocus: () => onSelect(key, 'focus'),
    onClick: () => onSelect(key, 'pointer'),
    onPointerEnter: (e: React.PointerEvent) => e.pointerType === 'mouse' && onSelect(key, 'pointer'),
    onKeyDown: (e: KeyboardEvent<SVGGElement>) => activate(e, key),
  });

  const planetLabel = (name: string, share: number) => t('scene.merkez.orbit.planet', { name, share: fmt.pct(share, share < 0.1 ? 1 : 0) });

  return (
    <svg
      ref={ref}
      className={`mz-orbit${moving ? '' : ' mz-still'}`}
      viewBox={`0 0 ${VB} ${VB}`}
      role={decorative ? 'img' : 'group'}
      aria-label={decorative ? t('scene.merkez.orbit.emptyAria') : t('scene.merkez.orbit.aria')}
      onKeyDown={onKeyDown}
    >
      <defs>
        <radialGradient id={`${uid}-sun`} cx="50%" cy="46%" r="60%">
          <stop offset="0" stopColor="#14100a" />
          <stop offset="0.72" stopColor="#2a1f0d" />
          <stop offset="1" stopColor="#7a5a22" />
        </radialGradient>
        <radialGradient id={`${uid}-glow`} cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#d8a84d" stopOpacity="0.28" />
          <stop offset="1" stopColor="#d8a84d" stopOpacity="0" />
        </radialGradient>
        <pattern id={`${uid}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="#16171a" />
          <rect width="2.6" height="6" fill="var(--warning)" />
        </pattern>
      </defs>

      <circle cx={CX} cy={CY} r={VB / 2} fill={`url(#${uid}-glow)`} className="mz-halo" />
      {STAR_FIELD.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="var(--text-primary)" opacity={s.o} aria-hidden="true" />)}

      {/* orbit guide rings */}
      <g aria-hidden="true">
        {orbit.planets.map((p) => <circle key={p.key} cx={CX} cy={CY} r={p.orbitR} className={`mz-ring${selectedKey === p.key ? ' is-sel' : ''}`} />)}
        {orbit.rest ? orbitRings(orbit.rest.orbitR) : null}
        {decorative ? [130, 170, 210, 250].map((r) => <g key={r}>{orbitRings(r)}</g>) : null}
      </g>

      {/* sun */}
      <g className="mz-sun">
        <circle cx={CX} cy={CY} r={SUN_R + 10} className="mz-corona" />
        <circle cx={CX} cy={CY} r={SUN_R} fill={`url(#${uid}-sun)`} />
        {sunTokens !== null ? (
          <>
            <text x={CX} y={CY + 4} textAnchor="middle" className="mz-sun-val">{fmt.compact(sunTokens)}</text>
            <text x={CX} y={CY + 22} textAnchor="middle" className="mz-sun-lab">{t('scene.merkez.sun.label')}</text>
          </>
        ) : null}
      </g>

      {/* model mix ring */}
      <g className="mz-models">
        {arcs.map((a) => {
          const sel = selectedKey === a.key;
          const mid = (a.a0 + a.a1) / 2;
          const name = a.model.displayName ?? a.model.modelId;
          const label = a.unpriced
            ? t('scene.merkez.orbit.modelUnpriced', { name, share: fmt.pct(a.share, 1) })
            : t('scene.merkez.orbit.model', { name, share: fmt.pct(a.share, 1) });
          const tag = polar(MODEL_R, mid);
          return (
            <g key={a.key} {...(decorative ? {} : handlers(a.key))} {...(decorative ? {} : { 'aria-label': label })} className={`mz-item mz-arc${sel ? ' is-sel' : ''}`}>
              <path d={arcPath(MODEL_R, a.a0, a.a1)} className="mz-hit" strokeWidth={MODEL_W + 14} />
              <path d={arcPath(MODEL_R, a.a0, a.a1)} stroke={a.unpriced ? `url(#${uid}-hatch)` : a.color} strokeWidth={sel ? MODEL_W + 4 : MODEL_W} className="mz-arc-line" fill="none" />
              {a.unpriced ? <path d={arcPath(MODEL_R, a.a0, a.a1)} className="mz-arc-unpriced" strokeWidth={MODEL_W + 2} fill="none" /> : null}
              {a.unpriced ? <text x={tag.x} y={tag.y + 3.5} textAnchor="middle" className="mz-arc-q" aria-hidden="true">?</text> : null}
              <path d={arcPath(MODEL_R, a.a0, a.a1)} className="mz-focus" strokeWidth={MODEL_W + 10} fill="none" />
            </g>
          );
        })}
      </g>

      {/* planets */}
      {orbit.planets.map((p) => {
        const sel = selectedKey === p.key;
        const pos = polar(p.orbitR, p.angle);
        const name = projectName(p.project);
        return (
          <g key={p.key} className="mz-spin" style={{ animationDuration: `${p.durationS}s` }}>
            <g aria-hidden="true">
              {[0.1, 0.2, 0.34].map((o, i) => (
                <path key={i} d={arcPath(p.orbitR, p.angle - 46 + i * 15, p.angle - 31 + i * 15)} stroke={p.color} strokeOpacity={o} strokeWidth={sel ? 2.4 : 1.6} strokeLinecap="round" fill="none" />
              ))}
            </g>
            <g {...(decorative ? {} : handlers(p.key))} {...(decorative ? {} : { 'aria-label': planetLabel(name, p.share) })} className={`mz-item mz-planet${sel ? ' is-sel' : ''}`}>
              <circle cx={pos.x} cy={pos.y} r={Math.max(p.r + 9, 22)} className="mz-hit" />
              {sel ? <circle cx={pos.x} cy={pos.y} r={p.r + 6} className="mz-halo-sel" /> : null}
              <circle cx={pos.x} cy={pos.y} r={p.r} fill={p.color} className="mz-planet-body" />
              <circle cx={pos.x - p.r * 0.3} cy={pos.y - p.r * 0.3} r={p.r * 0.38} fill="#fff" opacity="0.22" />
              <circle cx={pos.x} cy={pos.y} r={p.r + 9} className="mz-focus" fill="none" />
            </g>
          </g>
        );
      })}

      {orbit.rest ? (
        <g>
          <g {...(decorative ? {} : handlers(orbit.rest.key))} {...(decorative ? {} : { 'aria-label': t('scene.merkez.orbit.rest', { count: orbit.rest.count, share: fmt.pct(orbit.rest.share, 1) }) })} className={`mz-item mz-rest${selectedKey === 'rest' ? ' is-sel' : ''}`}>
            {(() => {
              const pos = polar(orbit.rest.orbitR, orbit.rest.angle);
              return (
                <>
                  <circle cx={pos.x} cy={pos.y} r={22} className="mz-hit" />
                  <circle cx={pos.x} cy={pos.y} r={11} className="mz-rest-body" />
                  <text x={pos.x} y={pos.y + 3.5} textAnchor="middle" className="mz-rest-txt" aria-hidden="true">+{orbit.rest.count}</text>
                  <circle cx={pos.x} cy={pos.y} r={18} className="mz-focus" fill="none" />
                </>
              );
            })()}
          </g>
        </g>
      ) : null}
    </svg>
  );
}
