import { useEffect, useMemo, useState } from 'react';

/** Deterministic pseudo-random so the background is identical across renders (and tests). */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function stars(seed: number, n: number) {
  const r = lcg(seed);
  return Array.from({ length: n }, () => ({ x: Math.round(r() * 1600), y: Math.round(r() * 900), r: 0.5 + r() * 1.1, o: 0.25 + r() * 0.5 }));
}

/**
 * Very subtle ambient layer: two drifting star layers + slow orbital ellipses (pure CSS/SVG).
 * Decorative only (aria-hidden). Animation is paused while the document is hidden and disabled
 * entirely under prefers-reduced-motion (see shell.css).
 */
export function Starfield() {
  const near = useMemo(() => stars(7, 38), []);
  const far = useMemo(() => stars(31, 70), []);
  const [paused, setPaused] = useState(() => typeof document !== 'undefined' && document.hidden);
  useEffect(() => {
    const on = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return (
    <div className={`bg-layer${paused ? ' paused' : ''}`} aria-hidden="true" data-testid="starfield">
      <svg className="bg-svg bg-far" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" focusable="false">
        {far.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.r * 0.8} fill="#f0e9dc" opacity={s.o * 0.6} />)}
      </svg>
      <svg className="bg-svg bg-near" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" focusable="false">
        {near.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={s.r} fill={i % 7 === 0 ? '#d8a84d' : '#f0e9dc'} opacity={s.o} />)}
      </svg>
      <svg className="bg-svg bg-orbits" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" focusable="false">
        <g className="bg-spin a" fill="none" stroke="#d8a84d" strokeWidth="1">
          <ellipse cx="800" cy="450" rx="620" ry="250" transform="rotate(-18 800 450)" opacity=".07" />
          <circle cx="1400" cy="313" r="3" fill="#d8a84d" stroke="none" opacity=".35" />
        </g>
        <g className="bg-spin b" fill="none" stroke="#7ab4ab" strokeWidth="1">
          <ellipse cx="800" cy="450" rx="860" ry="380" transform="rotate(12 800 450)" opacity=".05" />
          <circle cx="180" cy="520" r="2.5" fill="#7ab4ab" stroke="none" opacity=".3" />
        </g>
      </svg>
    </div>
  );
}
