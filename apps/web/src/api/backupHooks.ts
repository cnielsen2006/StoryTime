import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BackupCreate, BackupList, BackupRestore, BackupRestoreResult, BackupSummary } from '@storytime/shared';
import { ApiError, del, get, post } from './client.js';

export const backupsKey = ['backups'] as const;

export const useBackups = () => useQuery({ queryKey: backupsKey, queryFn: () => get<BackupList>('/backups') });

export function useCreateBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BackupCreate) => post<BackupSummary>('/backups', body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: backupsKey }),
  });
}

export function useDeleteBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => del(`/backups/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: backupsKey }),
  });
}

export function useRestoreBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: BackupRestore & { id: string }) =>
      post<BackupRestoreResult>(`/backups/${id}/restore`, body),
    onSuccess: () => {
      // Restored stories change the book list and anything already open; a safety backup joins the history.
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['project'] });
      void queryClient.invalidateQueries({ queryKey: backupsKey });
    },
  });
}

/** The file goes up as raw bytes, which api() would JSON-encode, so this talks to fetch itself. */
export async function uploadBackup(file: File): Promise<BackupSummary> {
  const response = await fetch('/api/backups/import', {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: file,
  });
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const detail = typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
    throw new ApiError(
      response.status,
      typeof detail.message === 'string' ? detail.message : `Upload failed with status ${response.status}`,
    );
  }
  return payload as BackupSummary;
}

export function useUploadBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: uploadBackup,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: backupsKey }),
  });
}
