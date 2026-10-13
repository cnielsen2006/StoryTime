import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChatHistory, ChatScope } from '@storytime/shared';
import { api, get, post } from './client.js';
import { projectKey } from './hooks.js';

const chatKey = (projectId: string, scope: ChatScope) =>
  ['revision-chat', projectId, scope.scopeType, scope.scopeId] as const;

const scopeQuery = (scope: ChatScope) => `scopeType=${scope.scopeType}&scopeId=${encodeURIComponent(scope.scopeId)}`;

/** A reply that never arrived, say because the page was closed mid-turn, is not worth waiting on forever. */
const GIVE_UP_AFTER_MS = 15 * 60_000;

/**
 * The conversation about one piece of the manuscript. While the last message is
 * the author's and no reply has landed, keeps checking, so a turn started before
 * the page was reloaded still shows up when it finishes.
 */
export function useRevisionChat(projectId: string, scope: ChatScope, waitingLocally: boolean) {
  return useQuery({
    queryKey: chatKey(projectId, scope),
    queryFn: () => get<ChatHistory>(`/projects/${projectId}/revision-chat?${scopeQuery(scope)}`),
    refetchInterval: (query) => {
      const last = query.state.data?.messages.at(-1);
      const waiting = last?.role === 'user' && Date.now() - last.createdAt < GIVE_UP_AFTER_MS;
      return waiting && !waitingLocally ? 3000 : false;
    },
  });
}

export function useSendChat(projectId: string, scope: ChatScope) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { message: string; attributeDialogue?: boolean }) =>
      post<{ runId: string; chatId: string; messageId: string }>(`/projects/${projectId}/revision-chat`, {
        ...scope,
        ...body,
      }),
    // The author's message is stored as soon as it is sent, so show it right away.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chatKey(projectId, scope) }),
  });
}

export function useClearChat(projectId: string, scope: ChatScope) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>(`/projects/${projectId}/revision-chat?${scopeQuery(scope)}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: chatKey(projectId, scope) }),
  });
}

/** After a turn the text may have changed under any of these views. */
export function useRefreshAfterChat(projectId: string, scope: ChatScope) {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: chatKey(projectId, scope) }),
      queryClient.invalidateQueries({ queryKey: projectKey(projectId) }),
      queryClient.invalidateQueries({ queryKey: ['versions'] }),
      queryClient.invalidateQueries({ queryKey: ['scenes'] }),
      queryClient.invalidateQueries({ queryKey: ['dialogue'] }),
    ]);
  };
}
