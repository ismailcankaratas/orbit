import { useId } from 'react';
import { Icon } from '../components/icons';
import { CHAPTERS, chapterBySlug } from '../experience/chapters';
import { useExperience } from '../experience/context';
import { useT } from '../i18n';
import { pad2, readyNeighbour } from './chapterNav';

/** Layer D: "01 / 12 · Merkez", one dot per chapter, prev/next, shortcut hints. */
export function ChapterRail() {
  const t = useT();
  const x = useExperience();
  const descId = useId();
  const active = chapterBySlug(x.activeChapter ?? undefined);
  const prev = readyNeighbour(x.activeChapter, -1);
  const next = readyNeighbour(x.activeChapter, 1);
  const total = CHAPTERS.length;

  const step = (dir: 1 | -1) => {
    const target = dir === 1 ? next : prev;
    if (target) x.goToChapter(target.slug);
    else x.announce(t(dir === 1 ? 'shell.rail.noNext' : 'shell.rail.noPrev'));
  };

  return (
    <div className="sh-rail" role="group" aria-label={t('shell.rail.label')} data-testid="chapter-rail">
      <p className="sh-rail-pos" data-testid="rail-position">
        {active ? t('shell.rail.position', { n: pad2(active.number), total, title: t(active.titleKey) }) : t('shell.explorer.title')}
      </p>
      <span id={descId} className="sr-only">{t('shell.rail.notReady')}</span>
      <ol className="sh-dots" aria-label={t('shell.rail.dots')}>
        {CHAPTERS.map((c) => {
          const ready = c.status === 'ready';
          const isActive = c.slug === active?.slug;
          const label = t('shell.rail.dot', { n: pad2(c.number), title: t(c.titleKey) });
          return (
            <li key={c.slug}>
              <button
                type="button"
                className={`sh-dot${isActive ? ' active' : ''}${ready ? '' : ' planned'}`}
                aria-label={label}
                title={ready ? `${pad2(c.number)} · ${t(c.titleKey)}` : `${pad2(c.number)} · ${t(c.titleKey)} — ${t('shell.rail.notReady')}`}
                {...(isActive ? { 'aria-current': 'step' as const } : {})}
                {...(ready ? {} : { 'aria-disabled': true, 'aria-describedby': descId })}
                onClick={() => {
                  if (ready) x.goToChapter(c.slug);
                  else x.announce(t('shell.catalog.notReady', { title: t(c.titleKey) }));
                }}
              >
                <i aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ol>
      <div className="sh-rail-actions">
        <button type="button" className="icon-btn sm" aria-label={t('shell.rail.prev')} title={prev ? t('shell.rail.prev') : t('shell.rail.noPrev')} aria-disabled={!prev} onClick={() => step(-1)}>
          <Icon name="chevL" size={18} />
        </button>
        <button type="button" className="icon-btn sm" aria-label={t('shell.rail.next')} title={next ? t('shell.rail.next') : t('shell.rail.noNext')} aria-disabled={!next} onClick={() => step(1)}>
          <Icon name="chevR" size={18} />
        </button>
        <button type="button" className="sh-hint" onClick={() => x.openCatalog()} aria-label={t('shell.rail.catalogButton')} aria-keyshortcuts="C">
          <kbd>C</kbd><span>{t('shell.rail.hint.catalog')}</span>
        </button>
        <span className="sh-hint static" aria-hidden="true"><kbd>←</kbd><kbd>→</kbd><span>{t('shell.rail.hint.arrows')}</span></span>
        <span className="sh-hint static" aria-hidden="true"><kbd>/</kbd><span>{t('shell.rail.hint.ask')}</span></span>
        <button type="button" className="sh-hint" onClick={x.openHelp} aria-label={t('shell.rail.helpButton')} aria-keyshortcuts="?">
          <kbd>?</kbd><span>{t('shell.rail.hint.help')}</span>
        </button>
      </div>
    </div>
  );
}
