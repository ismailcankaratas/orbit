import { useEffect, useRef } from 'react';

export interface ShortcutHandlers {
  next: () => void;
  prev: () => void;
  first: () => void;
  last: () => void;
  catalog: () => void;
  help: () => void;
  /** True while a modal overlay (catalog/help/settings) is open: only the overlay reacts to keys. */
  blocked: boolean;
}

const TYPING = 'input,textarea,select,[contenteditable=""],[contenteditable="true"]';
/** Widgets that consume arrow/Home/End themselves (a scene can also opt in with data-orbit-keys). */
const OWN_KEYS = '[role="dialog"],[role="listbox"],[role="tablist"],[role="slider"],[role="radiogroup"],[role="menu"],[role="grid"],[role="tree"],[data-orbit-keys]';

const NAV_KEYS = new Set(['ArrowRight', 'ArrowLeft', 'PageDown', 'PageUp', 'Home', 'End']);

export const isTypingTarget = (el: EventTarget | null): boolean => el instanceof Element && el.closest(TYPING) !== null;

/**
 * Global chapter shortcuts. Ignored while typing (inputs, textarea, select, contenteditable),
 * with modifier keys, when a handler already called preventDefault, or inside widgets that own
 * arrow keys. `/` only moves focus to Orbit Ask (the character is then typed there by the browser).
 */
export function useShortcuts(h: ShortcutHandlers) {
  const ref = useRef(h);
  useEffect(() => { ref.current = h; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const c = ref.current;
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (c.blocked || isTypingTarget(e.target)) return;
      const own = e.target instanceof Element && e.target.closest(OWN_KEYS) !== null;
      if (own && NAV_KEYS.has(e.key)) return;
      switch (e.key) {
        case 'ArrowRight':
        case 'PageDown':
          e.preventDefault();
          c.next();
          return;
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          c.prev();
          return;
        case 'Home':
          e.preventDefault();
          c.first();
          return;
        case 'End':
          e.preventDefault();
          c.last();
          return;
        case 'c':
        case 'C':
          if (e.repeat) return;
          e.preventDefault();
          c.catalog();
          return;
        case '?':
          if (e.repeat) return;
          e.preventDefault();
          c.help();
          return;
        case '/': {
          const input = document.querySelector<HTMLElement>('[data-orbit-ask-input]');
          if (input) input.focus(); // no preventDefault: the "/" is typed into Ask, which opens its catalog mode
          else {
            e.preventDefault();
            c.catalog();
          }
          return;
        }
        default:
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}
