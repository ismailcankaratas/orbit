import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { useFilterHref } from '../api/filters';
import { useT } from '../i18n';

/** Link that preserves the global filter params (range/from/to/project/model). */
export function FLink({ to, extra, ...rest }: Omit<LinkProps, 'to'> & { to: string; extra?: Record<string, string> }) {
  const href = useFilterHref();
  return <Link to={href(to, extra)} {...rest} />;
}

export function Crumbs({ items }: { items: { to?: string; label: string }[] }) {
  const t = useT();
  return (
    <nav aria-label={t('nav.breadcrumb')}>
      <ol className="crumbs">
        {items.map((i, n) => (
          <li key={n} {...(n === items.length - 1 ? { 'aria-current': 'page' as const } : {})}>
            {i.to ? <FLink to={i.to}>{i.label}</FLink> : <span className="trunc wrap-safe" style={{ maxWidth: 320 }} title={i.label}>{i.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function PageHeader({ eyebrow, title, lead, actions, crumbs }: { eyebrow?: string; title: ReactNode; lead?: ReactNode; actions?: ReactNode; crumbs?: { to?: string; label: string }[] }) {
  return (
    <header className="page-head">
      {crumbs ? <Crumbs items={crumbs} /> : null}
      {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h1 style={{ fontSize: 'clamp(26px,4vw,40px)', minWidth: 0 }} className="wrap-safe">{title}</h1>
        {actions ? <div className="row">{actions}</div> : null}
      </div>
      {lead ? <p className="muted" style={{ maxWidth: '70ch' }}>{lead}</p> : null}
    </header>
  );
}

export function Card({ title, aside, children, className = '', id }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  const hid = useId();
  return (
    <section className={`card ${className}`} aria-labelledby={title ? hid : undefined} {...(id ? { id } : {})}>
      {title ? (
        <div className="card-head">
          <h2 id={hid}>{title}</h2>
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Tabs({ tabs, value, onChange, label }: { tabs: { id: string; label: string }[]; value: string; onChange: (id: string) => void; label: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + tabs.length) % tabs.length;
    const next = tabs[n];
    if (next) {
      onChange(next.id);
      refs.current[n]?.focus();
    }
  };
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tb, i) => (
        <button key={tb.id} type="button" role="tab" id={`tab-${tb.id}`} aria-selected={tb.id === value} aria-controls={`panel-${tb.id}`} tabIndex={tb.id === value ? 0 : -1} ref={(el) => { refs.current[i] = el; }} onClick={() => onChange(tb.id)} onKeyDown={(e) => onKey(e, i)}>
          {tb.label}
        </button>
      ))}
    </div>
  );
}

export function Trunc({ text, max = 260 }: { text: string; max?: number }) {
  return <span className="trunc" style={{ maxWidth: max }} title={text}>{text}</span>;
}
