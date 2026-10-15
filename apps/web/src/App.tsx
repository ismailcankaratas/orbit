import { useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { StatusDTO } from '@orbit/core';
import { useSettings, useStatus } from './api/hooks';
import { ErrorState, Skeleton } from './components/states';
import { useI18n, isLocale } from './i18n';
import { Agents } from './features/agents/Agents';
import { Costs } from './features/costs/Costs';
import { Reports } from './features/reports/Reports';
import { Story } from './features/reports/Story';
import { Timeline } from './features/timeline/Timeline';
import { Onboarding } from './features/onboarding/Onboarding';
import { ProjectDetail } from './features/projects/ProjectDetail';
import { Projects } from './features/projects/Projects';
import { SessionDetail } from './features/sessions/SessionDetail';
import { Sessions } from './features/sessions/Sessions';
import { Settings } from './features/settings/Settings';
import { Starfield } from './ds';
import { ChapterScene, ExperienceShell, ExplorerFrame, NotFoundScene, type ExplorerView } from './shell';

export const needsOnboarding = (s: StatusDTO) => s.mode === 'none' || (!s.consentGranted && s.mode !== 'demo');

/** Server settings win over localStorage once loaded. Also refetches data when the status revision moves (polling fallback). */
function Sync() {
  const settings = useSettings();
  const status = useStatus();
  const { setLocale, setTimezone, locale, timezone } = useI18n();
  const qc = useQueryClient();
  const rev = useRef<number | null>(null);
  useEffect(() => {
    const s = settings.data;
    if (!s) return;
    if (isLocale(s.locale) && s.locale !== locale) setLocale(s.locale);
    if (s.timezone && s.timezone !== timezone) setTimezone(s.timezone);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data?.locale, settings.data?.timezone]);
  const r = status.data?.revision;
  useEffect(() => {
    if (r === undefined) return;
    if (rev.current !== null && rev.current !== r) void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'status' });
    rev.current = r;
  }, [r, qc]);
  return null;
}

/** `/` -> first chapter, keeping the filter query string. */
function RedirectHome() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: '/bolum/merkez', search }} replace />;
}

const explorer = (view: ExplorerView, el: JSX.Element) => <ExplorerFrame view={view}>{el}</ExplorerFrame>;

/** Routes rendered inside the shell's scene area. */
export function ShellRoutes() {
  return (
    <Routes>
      <Route index element={<RedirectHome />} />
      <Route path="bolum/:slug" element={<ChapterScene />} />
      {/* Transitional "Veri gezgini": legacy views inside the scene area; not linked from any persistent nav. */}
      <Route path="projects" element={explorer('projects', <Projects />)} />
      <Route path="projects/:id" element={explorer('project', <ProjectDetail />)} />
      <Route path="sessions" element={explorer('sessions', <Sessions />)} />
      <Route path="sessions/:id" element={explorer('session', <SessionDetail />)} />
      <Route path="agents" element={explorer('agents', <Agents />)} />
      <Route path="timeline" element={explorer('timeline', <Timeline />)} />
      <Route path="costs" element={explorer('costs', <Costs />)} />
      <Route path="reports" element={explorer('reports', <Reports />)} />
      <Route path="reports/story" element={explorer('story', <Story />)} />
      <Route path="settings" element={explorer('settings', <Settings />)} />
      <Route path="*" element={<NotFoundScene />} />
    </Routes>
  );
}

export function App() {
  const status = useStatus();
  if (status.isPending) return <div style={{ padding: 32 }}><Skeleton height={240} /></div>;
  if (status.isError && !status.data) return <main id="main" style={{ padding: 32 }}><ErrorState error={status.error} onRetry={() => void status.refetch()} /></main>;
  const s = status.data;
  if (s && needsOnboarding(s)) return (<><Starfield /><Sync /><Onboarding status={s} /></>);
  return (
    <ExperienceShell status={s}>
      <Sync />
      <ShellRoutes />
    </ExperienceShell>
  );
}
