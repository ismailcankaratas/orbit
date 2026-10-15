import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Icon } from './icons';

/** Tooltip that opens on hover, focus AND click/tap; Esc closes. Text is always available via aria-describedby. */
export function useTip() {
  const id = useId();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDoc);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [open]);
  return { id, open, setOpen, ref };
}

export function TipBox({ children, label, className = 'badge', body, hint }: { children: ReactNode; label: string; className?: string; body: string; hint?: string }) {
  const { id, open, setOpen, ref } = useTip();
  const tipRef = useRef<HTMLSpanElement>(null);
  // Keep the open tooltip inside the viewport (it is display:none while closed, so it never widens the page).
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el) return;
    el.style.left = '0px';
    if (!open) return;
    const r = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || window.innerWidth;
    if (r.right > vw - 8) el.style.left = `${Math.min(0, vw - 8 - r.right)}px`;
    else if (r.left < 8) el.style.left = `${8 - r.left}px`;
  }, [open]);
  return (
    <span className="tip-wrap" ref={ref} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className={className} aria-label={label} aria-describedby={id} aria-expanded={open} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen((o) => !o)}>
        {children}
      </button>
      <span role="tooltip" id={id} ref={tipRef} className={`tip${open ? ' open' : ''}`}>
        {body}
        {hint ? <span className="muted"> {hint}</span> : null}
      </span>
    </span>
  );
}

export function InfoTip({ label, text }: { label: string; text: string }) {
  return (
    <TipBox label={label} className="info-btn" body={text}>
      <Icon name="info" size={14} />
    </TipBox>
  );
}
