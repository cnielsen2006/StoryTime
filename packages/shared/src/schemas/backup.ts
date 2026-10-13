import { z } from 'zod';
import { Id } from './common.js';

export const BackupKind = z.enum(['manual', 'automatic', 'pre-restore', 'imported']);
export type BackupKind = z.infer<typeof BackupKind>;

/** What a backup says about one story it holds, so the history can be browsed without opening the file. */
export const BackupProjectInfo = z.object({
  id: Id,
  title: z.string(),
  wordCount: z.number().int(),
  chapters: z.number().int(),
  characters: z.number().int(),
  updatedAt: z.number().int(),
});
export type BackupProjectInfo = z.infer<typeof BackupProjectInfo>;

/** The first line of every backup file. */
export const BackupManifest = z.object({
  format: z.literal('storytime-backup'),
  formatVersion: z.literal(1),
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  label: z.string(),
  kind: BackupKind,
  createdAt: z.number().int(),
  /** Number of database migrations the app had applied when this was taken. */
  appSchema: z.number().int().min(0),
  projects: z.array(BackupProjectInfo),
  tableCounts: z.record(z.string(), z.number().int()),
});
export type BackupManifest = z.infer<typeof BackupManifest>;

export const BackupSummary = BackupManifest.extend({ bytes: z.number().int() });
export type BackupSummary = z.infer<typeof BackupSummary>;

export const BackupList = z.object({
  /** Newest first. */
  backups: z.array(BackupSummary),
  /** Where the files live on the machine running the server. */
  dir: z.string(),
});
export type BackupList = z.infer<typeof BackupList>;

export const BackupCreate = z.object({
  /** Empty or omitted means every story. */
  projectIds: z.array(Id).max(1000).optional(),
  label: z.string().trim().max(200).optional(),
});
export type BackupCreate = z.infer<typeof BackupCreate>;

export const RestoreMode = z.enum(['replace', 'copy']);
export type RestoreMode = z.infer<typeof RestoreMode>;

export const BackupRestore = z.object({
  /** Omitted means every story in the backup: replaced if it still exists, restored as it was if not. */
  projects: z.array(z.object({ id: Id, mode: RestoreMode })).max(1000).optional(),
});
export type BackupRestore = z.infer<typeof BackupRestore>;

export const BackupRestoreResult = z.object({
  restored: z.array(
    z.object({
      /** The story's id inside the backup. */
      sourceId: Id,
      /** The story's id now; differs from sourceId for a copy. */
      projectId: Id,
      title: z.string(),
      /** `restore` is a story that no longer existed and came back as it was. */
      mode: z.enum(['replace', 'copy', 'restore']),
    }),
  ),
  /** The backup taken of whatever was overwritten, if anything was. */
  safetyBackupId: z.string().nullable(),
  warnings: z.array(z.string()),
});
export type BackupRestoreResult = z.infer<typeof BackupRestoreResult>;
