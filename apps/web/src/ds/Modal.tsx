import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from '../components/icons';
import { useTrap } from '../components/Overlay';
import { useT } from '../i18n';

/** Centered modal dialog: focus trap, Esc to close, focus restored to the opener on unmount. */
export function Modal({ title, onClose, children, size = 'md', headerExtra }: { title: string; onClose: () => void; children: ReactNode; size?: 'md' | 'lg'; headerExtra?: ReactNode }) {
  const t = useT();
  const id = useId();
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  const stable = useCallback(() => closeRef.current(), []);
  const ref = useTrap(stable);
  return (
    <div className="overlay center modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && stable()}>
      <div className={`modal ${size}`} role="dialog" aria-modal="true" aria-labelledby={id} ref={ref}>
        <div className="modal-head">
          <h2 id={id}>{title}</h2>
          {headerExtra}
          <button type="button" className="icon-btn" onClick={stable} aria-label={t('action.close')}><Icon name="close" /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
