import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CharacterDetail, DialogueAttribution, DialogueUpdate, GenerationRun } from '@storytime/shared';
import { get, post, put } from './client.js';
import { projectKey } from './hooks.js';

/** Who speaks each quote in a version of the text. Null attribution means voices were never assigned. */
export const useDialogue = (versionId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: ['dialogue', versionId],
    queryFn: () => get<{ attribution: DialogueAttribution | null }>(`/versions/${versionId}/dialogue`),
    enabled: Boolean(versionId) && enabled,
    select: (data) => data.attribution,
  });

export interface DialogueStatus {
  versions: Array<{
    versionId: string;
    targetType: string;
    targetId: string;
    chapterId: string;
    label: string;
    assigned: boolean;
    source: 'model' | 'manual' | null;
  }>;
}

export const useDialogueStatus = (projectId: string) =>
  useQuery({
    queryKey: [...projectKey(projectId), 'dialogue-status'],
    queryFn: () => get<DialogueStatus>(`/projects/${projectId}/dialogue`),
  });

function refreshDialogue(queryClient: ReturnType<typeof useQueryClient>, projectId: string) {
  void queryClient.invalidateQueries({ queryKey: ['dialogue'] });
  void queryClient.invalidateQueries({ queryKey: [...projectKey(projectId), 'dialogue-status'] });
}

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

/** Wait for a run to end. Voice assignment is quick enough that polling beats holding a stream open. */
async function untilFinished(runId: string): Promise<GenerationRun> {
  for (;;) {
    const run = await get<GenerationRun>(`/runs/${runId}`);
    if (TERMINAL.has(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
}

/** Have the model work out who speaks each line, for the given chapters (or every written chapter). */
export function useAssignVoices(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (options: { chapterIds?: string[]; reattribute?: boolean } = {}) => {
      const { runId } = await post<{ runId: string }>(`/projects/${projectId}/runs`, {
        mode: 'chapters',
        kind: 'attribute',
        targetIds: options.chapterIds,
        reattribute: options.reattribute,
      });
      const run = await untilFinished(runId);
      if (run.status === 'failed') throw new Error(run.error ?? 'Could not assign voices.');
      return run;
    },
    onSettled: () => refreshDialogue(queryClient, projectId),
  });
}

export function useSaveDialogue(projectId: string, versionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: DialogueUpdate) => put<{ attribution: DialogueAttribution }>(`/versions/${versionId}/dialogue`, body),
    onSuccess: () => refreshDialogue(queryClient, projectId),
  });
}

/** Give every character without a voice a distinct one. */
export function useSuggestVoices(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (options: { overwrite?: boolean; narratorVoice?: string }) =>
      post<CharacterDetail[]>(`/projects/${projectId}/characters/suggest-voices`, options),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: projectKey(projectId) });
      void queryClient.invalidateQueries({ queryKey: ['character'] });
    },
  });
}
