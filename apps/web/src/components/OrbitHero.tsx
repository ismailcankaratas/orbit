import { useEffect, useState } from 'react';
import { useT } from '../i18n';

function useDocHidden() {
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
  useEffect(() => {
    const on = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return hidden;
}

function ring(count: number, r: number, offset: number) {
  const n = Math.min(count, 14);
  return Array.from({ length: n }, (_, i) => {
    const a = offset + (i / Math.max(n, 1)) * Math.PI * 2;
    return { x: 200 + Math.cos(a) * r, y: 200 + Math.sin(a) * r, i };
  });
}

/** Decorative orbit constellation whose node counts are driven by real data. Ambient rotation (12-14 s) pauses for reduced-motion (CSS) and hidden tabs. */
export function OrbitHero({ projects = 0, sessions = 0, agents = 0 }: { projects?: number; sessions?: number; agents?: number }) {
  const t = useT();
  const hidden = useDocHidden();
  const label = projects + sessions + agents > 0 ? t('orbit.alt', { projects, sessions, agents }) : t('orbit.altEmpty');
  const rings: [number, string, number, string][] = [
    [projects, 'var(--accent)', 62, 'r1'],
    [sessions, 'var(--teal)', 105, 'r2'],
    [agents, 'var(--violet)', 150, 'r3'],
  ];
  return (
    <svg className={`orbit-svg${hidden ? ' orbit-paused' : ''}`} viewBox="0 0 400 400" role="img" aria-label={label}>
      <defs>
        <radialGradient id="core" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#f6d38b" />
          <stop offset="1" stopColor="#d8a84d" />
        </radialGradient>
      </defs>
      {rings.map(([, , r], i) => (
        <circle key={i} cx="200" cy="200" r={r} fill="none" stroke="var(--line-strong)" strokeOpacity=".55" strokeWidth="1" strokeDasharray={i === 2 ? '3 6' : undefined} />
      ))}
      {rings.map(([count, color, r, cls], i) => (
        <g key={cls} className={`orbit-spin ${cls}`}>
          {ring(count, r, i * 0.9).map((n) => (
            <g key={n.i}>
              <line x1="200" y1="200" x2={n.x} y2={n.y} stroke={color} strokeOpacity=".12" />
              {i === 0 ? <circle cx={n.x} cy={n.y} r="6" fill={color} /> : i === 1 ? <rect x={n.x - 4.5} y={n.y - 4.5} width="9" height="9" fill={color} transform={`rotate(45 ${n.x} ${n.y})`} /> : <circle cx={n.x} cy={n.y} r="4" fill="none" stroke={color} strokeWidth="2" />}
            </g>
          ))}
        </g>
      ))}
      <circle cx="200" cy="200" r="22" fill="url(#core)" />
      <circle cx="200" cy="200" r="34" fill="none" stroke="var(--accent)" strokeOpacity=".35" />
    </svg>
  );
}
