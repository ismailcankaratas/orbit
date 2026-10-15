import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface Live {
  sseOk: boolean;
  /** Text for the aria-live region. */
  message: string;
  announce: (m: string) => void;
}
const LiveContext = createContext<Live>({ sseOk: false, message: '', announce: () => {} });
export const useLiveState = () => useContext(LiveContext);

const EVENTS = ['scan.updated', 'usage.updated', 'diagnostics.updated'] as const;

/** Provides SSE state + live-region text. SSE events only carry revisions; they invalidate queries, never carry content. */
export function LiveProvider({ children, announceTexts }: { children: ReactNode; announceTexts?: { updated: string } }) {
  const qc = useQueryClient();
  const [sseOk, setSseOk] = useState(false);
  const [message, setMessage] = useState('');
  const text = useRef(announceTexts?.updated ?? '');
  text.current = announceTexts?.updated ?? '';

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    let es: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 1000;
    let closed = false;
    let debounce: ReturnType<typeof setTimeout> | undefined;

    const onEvent = (e: Event) => {
      clearTimeout(debounce);
      debounce = setTimeout(() => {
        void qc.invalidateQueries();
        if (e.type === 'usage.updated' && text.current) setMessage(text.current);
      }, 250);
    };
    const connect = () => {
      if (closed) return;
      es = new EventSource('/api/v1/events');
      es.onopen = () => {
        delay = 1000;
        setSseOk(true);
      };
      for (const n of EVENTS) es.addEventListener(n, onEvent);
      es.onerror = () => {
        setSseOk(false);
        es?.close();
        es = null;
        timer = setTimeout(connect, delay);
        delay = Math.min(delay * 2, 30_000);
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      clearTimeout(debounce);
      es?.close();
    };
  }, [qc]);

  const value = useMemo<Live>(() => ({ sseOk, message, announce: setMessage }), [sseOk, message]);
  return <LiveContext.Provider value={value}>{children}</LiveContext.Provider>;
}
