const P: Record<string, string> = {
  home: 'M3 11l9-7 9 7M5 10v9h5v-5h4v5h5v-9',
  folder: 'M3 6h6l2 2h10v11H3z',
  agent: 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1',
  session: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 7v5l3 2',
  gear: 'M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6zM19 12l2-1-2-4-2 1a7 7 0 0 0-2-1l-.5-2h-5L9 7a7 7 0 0 0-2 1l-2-1-2 4 2 1a7 7 0 0 0 0 2l-2 1 2 4 2-1a7 7 0 0 0 2 1l.5 2h5l.5-2a7 7 0 0 0 2-1l2 1 2-4-2-1a7 7 0 0 0 0-2z',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'M6 6l12 12M18 6L6 18',
  chevL: 'M15 5l-7 7 7 7',
  chevR: 'M9 5l7 7-7 7',
  chevD: 'M5 9l7 7 7-7',
  info: 'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18zM12 11v6M12 7.5v.5',
  search: 'M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14zM20 20l-4-4',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  alert: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  check: 'M5 12l5 5 9-10',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  flat: 'M5 12h14',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.5M4 12h.5M4 18h.5',
  graph: 'M6 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M18 8m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M12 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M8 6.5l8 1M7 8l4 8M17 10l-4 6',
  timeline: 'M3 7h8M7 12h10M3 17h6M13 17h8',
  cost: 'M12 3v18M16 7.5C15 6.2 13.6 6 12 6c-2 0-3.5 1-3.5 2.5S10 11 12 11.5 15.5 13 15.5 14.5 14 17 12 17c-1.7 0-3.2-.3-4-1.5',
  report: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h7',
  plus: 'M12 5v14M5 12h14',
  play: 'M8 5l11 7-11 7z',
  full: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  refresh: 'M20 5v5h-5M4 19v-5h5M19 10a7 7 0 0 0-12-3L4 10M5 14a7 7 0 0 0 12 3l3-3',
};

export function Icon({ name, size = 20, className }: { name: keyof typeof P | string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className={className}>
      <path d={P[name] ?? P.info} />
    </svg>
  );
}

export function OrbitLogo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <ellipse cx="16" cy="16" rx="12" ry="5.5" fill="none" stroke="var(--accent)" strokeWidth="1.6" transform="rotate(-25 16 16)" />
      <circle cx="16" cy="16" r="4" fill="var(--accent)" />
      <circle cx="26" cy="11" r="1.8" fill="var(--teal)" />
    </svg>
  );
}
