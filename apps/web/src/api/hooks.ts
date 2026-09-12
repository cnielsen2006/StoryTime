import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type {
  AppSettings,
  Chapter,
  CharacterDetail,
  CharacterExperienceInput,
  GeneratedVersion,
  GenerationRun,
  Idea,
  Location,
  ModelInfo,
  PlotLineWithPoints,
  Project,
  ProjectGraph,
  ProviderStatus,
  Relationship,
  RunPreview,
  RunDetail,
  Scene,
  StoryParameters,
  EntityRevision,
  EntityRevisionDetail,
} from '@storytime/shared';
import { del, get, patch, post, put } from './client.js';

export type ProjectSummary = Project & { wordCount: number; staleCount: number };

/** What the character endpoints accept: experiences are inputs, not stored rows. */
export type CharacterSavePayload = Omit<Partial<CharacterDetail>, 'experiences'> & {
  id?: string;
  experiences?: CharacterExperienceInput[];
};

/** Everything derived from a project's bible lives under this key. */
export const projectKey = (projectId: string) => ['project', projectId] as const;

function useInvalidateProject(projectId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: projectKey(projectId) });
  };
}

// --- Projects ---------------------------------------------------------------

export const useProjects = () =>
  useQuery({ queryKey: ['projects'], queryFn: () => get<ProjectSummary[]>('/projects') });

export const useProjectGraph = (projectId: string, options?: Partial<UseQueryOptions<ProjectGraph>>) =>
  useQuery({
    queryKey: [...projectKey(projectId), 'graph'],
    queryFn: () => get<ProjectGraph>(`/projects/${projectId}/graph`),
    ...options,
  });

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; description?: string | null }) => post<Project>('/projects', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useUpdateProject(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<Project>) => patch<Project>(`/projects/${projectId}`, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: projectKey(projectId) });
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectId: string) => del(`/projects/${projectId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useUpdateStoryParameters(projectId: string) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: (body: Partial<StoryParameters>) =>
      put<StoryParameters>(`/projects/${projectId}/story-parameters`, body),
    onSuccess: invalidate,
  });
}

// --- Characters -------------------------------------------------------------

export const useCharacters = (projectId: string) =>
  useQuery({
    queryKey: [...projectKey(projectId), 'characters'],
    queryFn: () => get<CharacterDetail[]>(`/projects/${projectId}/characters`),
  });

export const useCharacter = (characterId: string | undefined) =>
  useQuery({
    queryKey: ['character', characterId],
    queryFn: () => get<CharacterDetail>(`/characters/${characterId}`),
    enabled: Boolean(characterId),
  });

export function useSaveCharacter(projectId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: ({ id, ...body }: CharacterSavePayload) =>
      id
        ? patch<CharacterDetail>(`/characters/${id}`, body)
        : post<CharacterDetail>(`/projects/${projectId}/characters`, body),
    onSuccess: (result) => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['character', result.id] });
    },
  });
}

export function useDeleteCharacter(projectId: string) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({ mutationFn: (id: string) => del(`/characters/${id}`), onSuccess: invalidate });
}

export const useRelationships = (projectId: string) =>
  useQuery({
    queryKey: [...projectKey(projectId), 'relationships'],
    queryFn: () => get<Relationship[]>(`/projects/${projectId}/relationships`),
  });

export function useSaveRelationship(projectId: string) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<Relationship> & { id?: string }) =>
      id
        ? patch<Relationship>(`/relationships/${id}`, body)
        : post<Relationship>(`/projects/${projectId}/relationships`, body),
    onSuccess: invalidate,
  });
}

export function useDeleteRelationship(projectId: string) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({ mutationFn: (id: string) => del(`/relationships/${id}`), onSuccess: invalidate });
}

// --- Locations --------------------------------------------------------------

export const useLocations = (projectId: string) =>
  useQuery({
    queryKey: [...projectKey(projectId), 'locations'],
    queryFn: () => get<Location[]>(`/projects/${projectId}/locations`),
  });

export function useSaveLocation(projectId: string) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<Location> & { id?: string }) =>
      id ? patch<Location>(`/locations/${id}`, body) : post<Location>(`/projects/${projectId}/locations`, body),
    onSuccess: invalidate,
  });
}

export function useDeleteLocation(projectId: string) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({ mutationFn: (id: string) => del(`/locations/${id}`), onSuccess: invalidate });
}

// --- Plot -------------------------------------------------------------------

export const usePlotLines = (projectId: string) =>
  useQuery({
    queryKey: [...projectKey(projectId), 'plot-lines'],
    queryFn: () => get<PlotLineWithPoints[]>(`/projects/${projectId}/plot-lines`),
  });

export function useSavePlotLine(projectId: string) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: ({ id, ...body }: { id?: string; name?: string; description?: string | null; kind?: string }) =>
      id ? patch(`/plot-lines/${id}`, body) : post(`/projects/${projectId}/plot-lines`, body),
    onSuccess: invalidate,
  });
}

export function useDeletePlotLine(projectId: string) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({ mutationFn: (id: string) => del(`/plot-lines/${id}`), onSuccess: invalidate });
}

export function useSavePlotPoint(projectId: string) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: ({ id, plotLineId, ...body }: Record<string, unknown> & { id?: string; plotLineId?: string }) =>
      id ? patch(`/plot-points/${id}`, body) : post(`/plot-lines/${plotLineId}/plot-points`, body),
    onSuccess: invalidate,
  });
}

export function useDeletePlotPoint(projectId: string) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({ mutationFn: (id: string) => del(`/plot-points/${id}`), onSuccess: invalidate });
}

// --- Ideas ------------------------------------------------------------------

export const useIdeas = (projectId: string, status?: string) =>
  useQuery({
    queryKey: [...projectKey(projectId), 'ideas', status ?? 'all'],
    queryFn: () => get<Idea[]>(`/projects/${projectId}/ideas${status ? `?status=${status}` : ''}`),
  });

export function useCaptureIdea(projectId: string) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: (text: string) => post<Idea>(`/projects/${projectId}/ideas`, { text }),
    onSuccess: invalidate,
  });
}

export function useUpdateIdea(projectId: string) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; text?: string; status?: string }) => patch<Idea>(`/ideas/${id}`, body),
    onSuccess: invalidate,
  });
}

export function useDeleteIdea(projectId: string) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({ mutationFn: (id: string) => del(`/ideas/${id}`), onSuccess: invalidate });
}

export function useLinkIdea(projectId: string) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: ({ ideaId, ...body }: { ideaId: string; entityType: string; entityId: string; note?: string | null }) =>
      post<Idea>(`/ideas/${ideaId}/links`, body),
    onSuccess: invalidate,
  });
}

export function useUnlinkIdea(projectId: string) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: ({ ideaId, linkId }: { ideaId: string; linkId: string }) =>
      del(`/ideas/${ideaId}/links/${linkId}`),
    onSuccess: invalidate,
  });
}

export function usePromoteIdea(projectId: string) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: ({ ideaId, ...body }: { ideaId: string; entityType: string; name: string; plotLineId?: string }) =>
      post<{ entityId: string; entityType: string }>(`/ideas/${ideaId}/promote`, body),
    onSuccess: invalidate,
  });
}

export const useEntityIdeas = (entityType: string, entityId: string | undefined) =>
  useQuery({
    queryKey: ['entity-ideas', entityType, entityId],
    queryFn: () =>
      get<Array<{ id: string; text: string; note: string | null; linkId: string | null }>>(
        `/entities/${entityType}/${entityId}/ideas`,
      ),
    enabled: Boolean(entityId),
  });

// --- Manuscript -------------------------------------------------------------

export const useChapters = (projectId: string) =>
  useQuery({
    queryKey: [...projectKey(projectId), 'chapters'],
    queryFn: () => get<Chapter[]>(`/projects/${projectId}/chapters`),
  });

export const useScenes = (chapterId: string | undefined) =>
  useQuery({
    queryKey: ['scenes', chapterId],
    queryFn: () => get<Scene[]>(`/chapters/${chapterId}/scenes`),
    enabled: Boolean(chapterId),
  });

export const useManuscript = (projectId: string) =>
  useQuery({
    queryKey: [...projectKey(projectId), 'manuscript'],
    queryFn: () =>
      get<{ title: string; chapters: Array<{ title: string; text: string; wordCount: number }>; draft: string | null; wordCount: number }>(
        `/projects/${projectId}/manuscript`,
      ),
  });

export const useVersions = (targetType: string, targetId: string | undefined) =>
  useQuery({
    queryKey: ['versions', targetType, targetId],
    queryFn: () => get<GeneratedVersion[]>(`/versions?targetType=${targetType}&targetId=${targetId}`),
    enabled: Boolean(targetId),
  });

export function useMakeVersionCurrent(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) => post<GeneratedVersion>(`/versions/${versionId}/make-current`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: ['versions'] });
    },
  });
}

export function useSaveManualVersion(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { targetType: string; targetId: string; content: string }) =>
      post<GeneratedVersion>('/versions', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: ['versions'] });
    },
  });
}

export function useMarkReviewed(projectId: string) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: ({ kind, id }: { kind: 'chapters' | 'scenes'; id: string }) => post(`/${kind}/${id}/mark-reviewed`),
    onSuccess: invalidate,
  });
}

export const useVersionDiff = (a: string | undefined, b: string | undefined) =>
  useQuery({
    queryKey: ['diff', a, b],
    queryFn: () =>
      get<{
        left: { versionNo: number; createdAt: number };
        right: { versionNo: number; createdAt: number };
        lines: Array<{ type: 'added' | 'removed' | 'unchanged'; value: string }>;
      }>(`/versions/${a}/diff/${b}`),
    enabled: Boolean(a && b && a !== b),
  });

// --- Runs -------------------------------------------------------------------

export const useRuns = (projectId: string) =>
  useQuery({
    queryKey: [...projectKey(projectId), 'runs'],
    queryFn: () => get<GenerationRun[]>(`/projects/${projectId}/runs`),
  });

export const useRun = (runId: string | undefined, refetch = false) =>
  useQuery({
    queryKey: ['run', runId],
    queryFn: () => get<RunDetail>(`/runs/${runId}`),
    enabled: Boolean(runId),
    refetchInterval: refetch ? 2000 : false,
  });

export function usePreviewRun(projectId: string) {
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => post<RunPreview>(`/projects/${projectId}/runs/preview`, body),
  });
}

export function useStartRun(projectId: string) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => post<{ runId: string }>(`/projects/${projectId}/runs`, body),
    onSuccess: invalidate,
  });
}

export function useCancelRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => post<{ cancelled: boolean }>(`/runs/${runId}/cancel`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['run'] }),
  });
}

export function useApplyOutline(projectId: string) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: (outline: unknown) =>
      put<{ chaptersCreated: number; chaptersUpdated: number; warnings: string[] }>(
        `/projects/${projectId}/outline`,
        outline,
      ),
    onSuccess: invalidate,
  });
}

export function useSplitDraft(projectId: string) {
  const invalidate = useInvalidateProject(projectId);
  return useMutation({
    mutationFn: () => post<{ created: number }>(`/projects/${projectId}/draft/split`),
    onSuccess: invalidate,
  });
}

// --- Revisions --------------------------------------------------------------

export const useRevisions = (entityType: string, entityId: string | undefined) =>
  useQuery({
    queryKey: ['revisions', entityType, entityId],
    queryFn: () => get<EntityRevision[]>(`/entities/${entityType}/${entityId}/revisions`),
    enabled: Boolean(entityId),
  });

export const useRevision = (revisionId: string | undefined) =>
  useQuery({
    queryKey: ['revision', revisionId],
    queryFn: () => get<EntityRevisionDetail>(`/revisions/${revisionId}`),
    enabled: Boolean(revisionId),
  });

export function useRestoreRevision(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (revisionId: string) => post(`/revisions/${revisionId}/restore`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: ['revisions'] });
      void queryClient.invalidateQueries({ queryKey: ['character'] });
    },
  });
}

// --- Settings ---------------------------------------------------------------

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => get<AppSettings>('/settings') });

export const useProviders = () =>
  useQuery({ queryKey: ['providers'], queryFn: () => get<ProviderStatus[]>('/providers') });

export const useModels = (provider: string | undefined) =>
  useQuery({
    queryKey: ['models', provider],
    queryFn: () => get<ModelInfo[]>(`/models?provider=${provider}`),
    enabled: Boolean(provider),
    retry: false,
  });

export function useSaveSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<AppSettings>) => put<AppSettings>('/settings', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });
}

export function useTestProvider() {
  return useMutation({
    mutationFn: (provider: string) => post<{ ok: boolean; message: string }>(`/providers/${provider}/test`),
  });
}
