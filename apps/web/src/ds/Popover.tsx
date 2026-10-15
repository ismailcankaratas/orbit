import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface PopoverApi {
  close: () => void;
}

/**
 * Non-modal popover anchored to a trigger button. Esc closes and returns focus to the trigger,
 * outside pointer-down and Tab-out close it. The panel is a labelled dialog.
 */
export function Popover({
  triggerLabel,
  triggerClassName = 'btn sm',
  trigger,
  panelLabel,
  align = 'end',
  panelClassName = '',
  children,
  testId,
}: {
  triggerLabel: string;
  triggerClassName?: string;
  trigger: ReactNode;
  panelLabel: string;
  align?: 'start' | 'end';
  panelClassName?: string;
  children: (api: PopoverApi) => ReactNode;
  testId?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) btn.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const node = panel.current;
    (node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close(false);
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
    };
  }, [open, close]);

  return (
    <span className="popover-wrap" ref={wrap} data-testid={testId}>
      <button ref={btn} type="button" className={triggerClassName} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} aria-label={triggerLabel} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open ? (
        <div
          id={id}
          ref={panel}
          role="dialog"
          aria-label={panelLabel}
          className={`popover-panel ${align} ${panelClassName}`}
          onBlur={(e) => {
            const next = e.relatedTarget as Node | null;
            if (next && !wrap.current?.contains(next)) close(false);
          }}
        >
          {children({ close: () => close() })}
        </div>
      ) : null}
    </span>
  );
}
