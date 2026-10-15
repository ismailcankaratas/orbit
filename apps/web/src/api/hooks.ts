import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type {
  AgentDetailDTO,
  AgentsDTO,
  AgentSummary,
  CostsDTO,
  StoryDTO,
  TimelineDTO,
  DiagnosticsDTO,
  OverviewDTO,
  Page,
  ProjectDetailDTO,
  ProjectSummary,
  SessionDetailDTO,
  SessionSummary,
  SettingsDTO,
  SettingsPatch,
  StatusDTO,
} from '@orbit/core';
import { apiGet, apiSend, buildUrl, type Query } from './client';
import { useLiveState } from './live';

const V = '/api/v1';
const enc = encodeURIComponent;

export function useStatus() {
  const { sseOk } = useLiveState();
  return useQuery({
    queryKey: ['status'],
    queryFn: ({ signal }) => apiGet<StatusDTO>(`${V}/status`, undefined, signal),
    // Polling fallback: only when SSE is not delivering; faster while a scan runs.
    refetchInterval: (q) => (q.state.data?.scan.state === 'scanning' ? 1500 : sseOk ? false : 15_000),
    retry: 1,
  });
}

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: ({ signal }) => apiGet<SettingsDTO>(`${V}/settings`, undefined, signal) });
export const useDiagnostics = () => useQuery({ queryKey: ['diagnostics'], queryFn: ({ signal }) => apiGet<DiagnosticsDTO>(`${V}/diagnostics`, undefined, signal) });

export const useOverview = (q: Query) =>
  useQuery({ queryKey: ['overview', q], queryFn: ({ signal }) => apiGet<OverviewDTO>(`${V}/overview`, q, signal), placeholderData: keepPreviousData });

export const useProjects = (q: Query) =>
  useQuery({ queryKey: ['projects', q], queryFn: ({ signal }) => apiGet<Page<ProjectSummary>>(`${V}/projects`, { limit: 200, ...q }, signal), placeholderData: keepPreviousData });

export const useProject = (id: string, q: Query) =>
  useQuery({ queryKey: ['project', id, q], queryFn: ({ signal }) => apiGet<ProjectDetailDTO>(`${V}/projects/${enc(id)}`, q, signal), placeholderData: keepPreviousData });

export const useSessions = (q: Query) =>
  useQuery({ queryKey: ['sessions', q], queryFn: ({ signal }) => apiGet<Page<SessionSummary>>(`${V}/sessions`, { limit: 200, ...q }, signal), placeholderData: keepPreviousData });

export const useSession = (id: string, q: Query) =>
  useQuery({ queryKey: ['session', id, q], queryFn: ({ signal }) => apiGet<SessionDetailDTO>(`${V}/sessions/${enc(id)}`, q, signal), placeholderData: keepPreviousData });

export const useAgents = (q: Query) =>
  useQuery({ queryKey: ['agents', q], queryFn: ({ signal }) => apiGet<AgentsDTO>(`${V}/agents`, { limit: 200, ...q }, signal), placeholderData: keepPreviousData });

export const useAgent = (id: string | null, q: Query) =>
  useQuery({ queryKey: ['agent', id, q], enabled: !!id, queryFn: ({ signal }) => apiGet<AgentDetailDTO>(`${V}/agents/${enc(id ?? '')}`, q, signal) });

export const useTimeline = (q: Query, groupBy: 'project' | 'agent') =>
  useQuery({ queryKey: ['timeline', groupBy, q], queryFn: ({ signal }) => apiGet<TimelineDTO>(`${V}/timeline`, { limit: 50, ...q, groupBy }, signal), placeholderData: keepPreviousData });

export const useCosts = (q: Query) =>
  useQuery({ queryKey: ['costs', q], queryFn: ({ signal }) => apiGet<CostsDTO>(`${V}/costs`, q, signal), placeholderData: keepPreviousData });

export const useStory = (q: Query) =>
  useQuery({ queryKey: ['story', q], queryFn: ({ signal }) => apiGet<StoryDTO>(`${V}/reports/summary`, q, signal), placeholderData: keepPreviousData });

export type { AgentSummary };

function useInvalidateAll() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries();
}

export function usePatchSettings() {
  const inv = useInvalidateAll();
  return useMutation({ mutationFn: (p: SettingsPatch) => apiSend<SettingsDTO | undefined>('PATCH', `${V}/settings`, p), onSuccess: inv });
}
export function useStartScan() {
  const inv = useInvalidateAll();
  return useMutation({ mutationFn: () => apiSend<unknown>('POST', `${V}/scan`), onSuccess: inv });
}
export function useSetAlias(projectId: string) {
  const inv = useInvalidateAll();
  return useMutation({ mutationFn: (alias: string | null) => apiSend<unknown>('PUT', `${V}/projects/${enc(projectId)}/alias`, { alias }), onSuccess: inv });
}
export function useDeleteArchive() {
  const inv = useInvalidateAll();
  return useMutation({ mutationFn: () => apiSend<unknown>('DELETE', `${V}/archive`, { confirm: 'DELETE_ORBIT_DATA' }), onSuccess: inv });
}

export const exportUrl = (q: Query, format: 'csv' | 'json' = 'csv') => buildUrl(`${V}/exports`, { ...q, format });
