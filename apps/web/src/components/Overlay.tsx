import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useT } from '../i18n';
import { Icon } from './icons';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function useTrap(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current;
    (node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      } else if (e.key === 'Tab' && node) {
        const f = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
        const first = f[0];
        const last = f[f.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prev?.focus?.();
    };
  }, [onClose]);
  return ref;
}

export function Drawer({ title, onClose, children, side = 'right' }: { title: string; onClose: () => void; children: ReactNode; side?: 'right' | 'left' }) {
  const t = useT();
  const id = useId();
  const ref = useTrap(onClose);
  return (
    <div className={`overlay ${side}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer" role="dialog" aria-modal="true" aria-labelledby={id} ref={ref}>
        <div className="card-head">
          <h2 id={id}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('action.close')}>
            <Icon name="close" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({ title, body, confirmLabel, phrase, onConfirm, onCancel, busy, error }: { title: string; body: ReactNode; confirmLabel: string; phrase?: string; onConfirm: () => void; onCancel: () => void; busy?: boolean; error?: ReactNode }) {
  const t = useT();
  const id = useId();
  const [typed, setTyped] = useState('');
  const ref = useTrap(onCancel);
  const ok = !phrase || typed === phrase;
  return (
    <div className="overlay center" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby={id} ref={ref}>
        <h2 id={id}>{title}</h2>
        <div className="stack">{body}</div>
        {phrase ? (
          <label className="field">
            <span>{t('confirm.typePhrase', { phrase })}</span>
            <input className="input mono" data-autofocus value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
        ) : null}
        {error}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" onClick={onCancel}>
            {t('action.cancel')}
          </button>
          <button type="button" className="btn danger" disabled={!ok || busy} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
