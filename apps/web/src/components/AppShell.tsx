import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import type { StatusDTO } from '@orbit/core';
import { useFilterHref } from '../api/filters';
import { useLiveState } from '../api/live';
import { useT } from '../i18n';
import { Drawer } from './Overlay';
import { Icon, OrbitLogo } from './icons';
import { LangSwitch, Topbar } from './Topbar';

const NAV = [
  { to: '/', key: 'nav.overview', icon: 'home', end: true },
  { to: '/projects', key: 'nav.projects', icon: 'folder' },
  { to: '/agents', key: 'nav.agents', icon: 'agent' },
  { to: '/sessions', key: 'nav.sessions', icon: 'session' },
  { to: '/timeline', key: 'nav.timeline', icon: 'timeline' },
  { to: '/costs', key: 'nav.costs', icon: 'cost' },
  { to: '/reports', key: 'nav.reports', icon: 'report' },
  { to: '/settings', key: 'nav.settings', icon: 'gear' },
] as const;

function lsGet(k: string) { try { return localStorage.getItem(k); } catch { return null; } }

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const t = useT();
  const href = useFilterHref();
  return (
    <nav className="nav" aria-label={t('nav.main')}>
      {NAV.map((n) => (
        <NavLink key={n.to} to={n.to === '/settings' ? n.to : href(n.to)} end={'end' in n} onClick={onNavigate} title={t(n.key)}>
          <Icon name={n.icon} />
          <span className="nav-label">{t(n.key)}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell({ status, children }: { status: StatusDTO | undefined; children: ReactNode }) {
  const t = useT();
  const { message } = useLiveState();
  const [collapsed, setCollapsed] = useState(() => lsGet('orbit.sidebar') === '1');
  const [menu, setMenu] = useState(false);
  const toggle = () => setCollapsed((c) => { try { localStorage.setItem('orbit.sidebar', c ? '0' : '1'); } catch { /* ignore */ } return !c; });
  return (
    <div className={`app${collapsed ? ' collapsed' : ''}`}>
      <a className="skip-link" href="#main">{t('a11y.skip')}</a>
      <aside className="sidebar">
        <span className="brand"><OrbitLogo /><span className="brand-name">orbit</span></span>
        <NavList />
        <div className="sidebar-foot">
          <button type="button" className="btn sm" onClick={toggle} aria-pressed={collapsed} aria-label={collapsed ? t('nav.expand') : t('nav.collapse')} title={collapsed ? t('nav.expand') : t('nav.collapse')}>
            <Icon name={collapsed ? 'chevR' : 'chevL'} size={16} />
            <span className="nav-label">{t('nav.collapse')}</span>
          </button>
          <p className="small muted nav-label" style={{ padding: '0 6px' }}>{t('nav.readonlyNote')}</p>
        </div>
      </aside>
      <div className="main">
        <Topbar status={status} onMenu={() => setMenu(true)} />
        <main id="main" tabIndex={-1} className="content">{children}</main>
      </div>
      {menu ? (
        <Drawer title={t('nav.menu')} side="left" onClose={() => setMenu(false)}>
          <NavList onNavigate={() => setMenu(false)} />
          <LangSwitch id="lang-menu" />
        </Drawer>
      ) : null}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{message}</div>
    </div>
  );
}
