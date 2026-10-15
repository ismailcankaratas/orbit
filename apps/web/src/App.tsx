import { useEffect, useRef } from 'react';
import { Route, Routes } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { StatusDTO } from '@orbit/core';
import { useSettings, useStatus } from './api/hooks';
import { AppShell } from './components/AppShell';
import { ErrorState, Skeleton } from './components/states';
import { useI18n, isLocale } from './i18n';
import { Agents } from './features/agents/Agents';
import { Costs } from './features/costs/Costs';
import { Reports } from './features/reports/Reports';
import { Story } from './features/reports/Story';
import { Timeline } from './features/timeline/Timeline';
import { NotFound } from './features/NotFound';
import { Onboarding } from './features/onboarding/Onboarding';
import { Overview } from './features/overview/Overview';
import { ProjectDetail } from './features/projects/ProjectDetail';
import { Projects } from './features/projects/Projects';
import { SessionDetail } from './features/sessions/SessionDetail';
import { Sessions } from './features/sessions/Sessions';
import { Settings } from './features/settings/Settings';

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

export function App() {
  const status = useStatus();
  if (status.isPending) return <div style={{ padding: 32 }}><Skeleton height={240} /></div>;
  if (status.isError && !status.data) return <main id="main" style={{ padding: 32 }}><ErrorState error={status.error} onRetry={() => void status.refetch()} /></main>;
  const s = status.data;
  if (s && needsOnboarding(s)) return (<><Sync /><Onboarding status={s} /></>);
  return (
    <AppShell status={s}>
      <Sync />
      <Routes>
        <Route index element={<Overview />} />
        <Route path="projects" element={<Projects />} />
        <Route path="projects/:id" element={<ProjectDetail />} />
        <Route path="sessions" element={<Sessions />} />
        <Route path="sessions/:id" element={<SessionDetail />} />
        <Route path="agents" element={<Agents />} />
        <Route path="timeline" element={<Timeline />} />
        <Route path="costs" element={<Costs />} />
        <Route path="reports" element={<Reports />} />
        <Route path="reports/story" element={<Story />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppShell>
  );
}
