import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useMatch, useNavigate } from 'react-router-dom';
import type { StatusDTO } from '@orbit/core';
import { useFilterHref } from '../api/filters';
import { Drawer } from '../components/Overlay';
import { Starfield } from '../ds';
import { chapterBySlug } from '../experience/chapters';
import { ExperienceContext, type ExperienceActions } from '../experience/context';
import { Settings } from '../features/settings/Settings';
import { useT } from '../i18n';
import { OrbitAsk } from '../ask';
import { CatalogModal } from './CatalogModal';
import { ChapterRail } from './ChapterRail';
import { HelpOverlay } from './HelpOverlay';
import { TopBar } from './TopBar';
import { pad2, READY_CHAPTERS, readyNeighbour } from './chapterNav';
import { useShortcuts } from './useShortcuts';
import './shell.css';

/**
 * Application shell (ADR-003): Top Bar (A), Scene area (B), Orbit Ask (C) and Chapter Rail (D).
 * Provides ExperienceContext to scenes and Orbit Ask.
 */
export function ExperienceShell({ status, children }: { status: StatusDTO | undefined; children: ReactNode }) {
  const t = useT();
  const nav = useNavigate();
  const loc = useLocation();
  const href = useFilterHref();
  const match = useMatch('/bolum/:slug');
  const activeChapter = chapterBySlug(match?.params.slug)?.slug ?? null;

  const [catalog, setCatalog] = useState<{ filter: string } | null>(null);
  const [help, setHelp] = useState(false);
  const [settings, setSettings] = useState(false);
  const [message, setMessage] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLElement>(null);

  const announce = useCallback((text: string) => setMessage((p) => (p === text ? `${text}.` : text)), []);
  const closeAll = useCallback(() => { setCatalog(null); setHelp(false); setSettings(false); }, []);

  const goToChapter = useCallback((slug: string) => { closeAll(); nav(href(`/bolum/${encodeURIComponent(slug)}`)); }, [closeAll, nav, href]);
  const openExplorer = useCallback((path: string) => { closeAll(); nav(href(path)); }, [closeAll, nav, href]);
  const openCatalog = useCallback((filter = '') => { setHelp(false); setSettings(false); setCatalog({ filter }); }, []);
  const openHelp = useCallback(() => { setCatalog(null); setSettings(false); setHelp(true); }, []);
  const openSettings = useCallback(() => { setCatalog(null); setHelp(false); setSettings(true); }, []);
  const closeCatalog = useCallback(() => setCatalog(null), []);
  const closeHelp = useCallback(() => setHelp(false), []);
  const closeSettings = useCallback(() => setSettings(false), []);

  const actions = useMemo<ExperienceActions>(
    () => ({ activeChapter, goToChapter, openCatalog, openHelp, openSettings, openExplorer, announce }),
    [activeChapter, goToChapter, openCatalog, openHelp, openSettings, openExplorer, announce],
  );

  // Desktop: the document itself never scrolls (CSS keys off this class). Footer height -> --foot-h.
  useEffect(() => {
    document.documentElement.classList.add('orbit-shell-active');
    return () => document.documentElement.classList.remove('orbit-shell-active');
  }, []);
  useEffect(() => {
    const foot = footRef.current;
    const root = rootRef.current;
    if (!foot || !root || typeof ResizeObserver === 'undefined') return;
    const apply = () => root.style.setProperty('--foot-h', `${Math.ceil(foot.getBoundingClientRect().height)}px`);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(foot);
    return () => ro.disconnect();
  }, []);

  // Announce chapter / explorer changes to screen readers (not on first paint).
  const first = useRef(true);
  const path = loc.pathname;
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const c = chapterBySlug(path.startsWith('/bolum/') ? path.split('/')[2] : undefined);
    if (c) announce(t('shell.announce.chapter', { n: pad2(c.number), title: t(c.titleKey) }));
    else if (!path.startsWith('/bolum/')) announce(t('shell.announce.explorer', { title: t('shell.explorer.title') }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  const step = (dir: 1 | -1) => {
    const target = readyNeighbour(activeChapter, dir);
    if (target) goToChapter(target.slug);
    else announce(t(dir === 1 ? 'shell.rail.noNext' : 'shell.rail.noPrev'));
  };
  const edge = (which: 'first' | 'last') => {
    const target = which === 'first' ? READY_CHAPTERS[0] : READY_CHAPTERS[READY_CHAPTERS.length - 1];
    if (target && target.slug !== activeChapter) goToChapter(target.slug);
  };
  useShortcuts({
    next: () => step(1),
    prev: () => step(-1),
    first: () => edge('first'),
    last: () => edge('last'),
    catalog: () => openCatalog(),
    help: openHelp,
    blocked: catalog !== null || help || settings,
  });

  return (
    <ExperienceContext.Provider value={actions}>
      <div className="orbit-shell" ref={rootRef} data-shell>
        <a className="skip-link" href="#main">{t('a11y.skip')}</a>
        <Starfield />
        <TopBar status={status} onSettings={openSettings} />
        <main id="main" tabIndex={-1} className="sh-scene" aria-label={t('shell.scene.region')}>
          {children}
        </main>
        <footer className="sh-foot" ref={footRef} aria-label={t('shell.footer.region')}>
          <ChapterRail />
          <div className="sh-ask"><OrbitAsk /></div>
        </footer>
        <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="live-region">{message}</div>
        {catalog ? <CatalogModal initialFilter={catalog.filter} onClose={closeCatalog} /> : null}
        {help ? <HelpOverlay onClose={closeHelp} /> : null}
        {settings ? (
          <Drawer title={t('shell.settings.title')} wide onClose={closeSettings}>
            <Settings />
          </Drawer>
        ) : null}
      </div>
    </ExperienceContext.Provider>
  );
}
