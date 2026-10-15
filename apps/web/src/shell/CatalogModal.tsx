import { useId, useMemo, useRef, useState } from 'react';
import { Modal } from '../ds';
import { CHAPTERS } from '../experience/chapters';
import { useExperience } from '../experience/context';
import { useT } from '../i18n';
import { matchChapter, pad2 } from './chapterNav';

/** Chapter catalog: filterable listbox (aria-activedescendant), arrows move, Enter goes, Esc closes. */
export function CatalogModal({ initialFilter = '', onClose }: { initialFilter?: string; onClose: () => void }) {
  const t = useT();
  const x = useExperience();
  const listId = useId();
  const [filter, setFilter] = useState(initialFilter.replace(/^\/+/, ''));
  const [reason, setReason] = useState('');
  const [activeSlug, setActiveSlug] = useState<string | null>(() => (initialFilter ? null : x.activeChapter));
  const listRef = useRef<HTMLUListElement>(null);

  const items = useMemo(
    () => CHAPTERS.filter((c) => matchChapter(c, filter, t(c.titleKey), t(c.summaryKey))),
    [filter, t],
  );
  const active = items.find((c) => c.slug === activeSlug) ?? items[0];
  const optId = (slug: string) => `${listId}-${slug}`;

  const move = (d: number) => {
    if (!items.length) return;
    const i = Math.max(0, items.findIndex((c) => c.slug === active?.slug));
    const next = items[(i + d + items.length) % items.length];
    if (next) {
      setActiveSlug(next.slug);
      setReason('');
      requestAnimationFrame(() => document.getElementById(optId(next.slug))?.scrollIntoView?.({ block: 'nearest' }));
    }
  };

  const choose = (slug: string | undefined) => {
    const c = CHAPTERS.find((k) => k.slug === slug);
    if (!c) return;
    if (c.status !== 'ready') {
      const msg = t('shell.catalog.notReady', { title: t(c.titleKey) });
      setReason(msg);
      x.announce(msg);
      return;
    }
    onClose();
    x.goToChapter(c.slug);
  };

  return (
    <Modal title={t('shell.catalog.title')} onClose={onClose}>
      <label className="field">
        <span className="sr-only">{t('shell.catalog.filter')}</span>
        <input
          className="input sh-catalog-input"
          data-autofocus
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          {...(active ? { 'aria-activedescendant': optId(active.slug) } : {})}
          value={filter}
          placeholder={t('shell.catalog.placeholder')}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => { setFilter(e.target.value.replace(/^\/+/, '')); setActiveSlug(null); setReason(''); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
            else if (e.key === 'Enter') { e.preventDefault(); choose(active?.slug); }
          }}
        />
      </label>
      <ul id={listId} ref={listRef} role="listbox" aria-label={t('shell.catalog.list')} className="sh-catalog-list">
        {items.map((c) => {
          const ready = c.status === 'ready';
          const isActive = c.slug === active?.slug;
          return (
            <li
              key={c.slug}
              id={optId(c.slug)}
              role="option"
              aria-selected={isActive}
              {...(ready ? {} : { 'aria-disabled': true })}
              className={`sh-opt${isActive ? ' active' : ''}${ready ? '' : ' planned'}`}
              onMouseMove={() => { if (!isActive) setActiveSlug(c.slug); }}
              onClick={() => choose(c.slug)}
            >
              <span className="sh-opt-num">{pad2(c.number)}</span>
              <span className="sh-opt-text">
                <strong>{t(c.titleKey)}</strong>
                <span className="small muted">{t(c.summaryKey)}</span>
              </span>
              <span className={`badge ${ready ? 'good' : 'unknown'}`}>{c.slug === x.activeChapter ? t('shell.catalog.current') : ready ? t('shell.catalog.ready') : t('shell.catalog.planned')}</span>
            </li>
          );
        })}
      </ul>
      {items.length === 0 ? <p className="muted" role="status">{t('shell.catalog.empty')}</p> : null}
      {reason ? <p className="sh-reason small" data-testid="catalog-reason">{reason}</p> : null}
      <p className="small muted sh-catalog-hint">{t('shell.catalog.hint')}</p>
    </Modal>
  );
}
