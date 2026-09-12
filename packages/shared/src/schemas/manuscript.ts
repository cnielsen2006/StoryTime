import { z } from 'zod';
import { StaleLevel, StopReason, VersionTargetType } from '../enums.js';
import { Id, OptionalText, RequiredName } from './common.js';

export const StaleReason = z.object({
  entityType: z.string(),
  entityId: Id,
  label: z.string(),
  field: z.string().nullable().optional(),
  at: z.number().int(),
});
export type StaleReason = z.infer<typeof StaleReason>;

export const ChapterCreate = z.object({
  title: RequiredName,
  summary: OptionalText,
  plotPointIds: z.array(Id).max(200).optional(),
});
export type ChapterCreate = z.infer<typeof ChapterCreate>;

export const ChapterUpdate = ChapterCreate.partial();
export type ChapterUpdate = z.infer<typeof ChapterUpdate>;

export const Chapter = z.object({
  id: Id,
  projectId: Id,
  sortOrder: z.number().int(),
  title: z.string(),
  summary: z.string().nullable(),
  plotPointIds: z.array(Id),
  currentVersionId: Id.nullable(),
  staleLevel: StaleLevel,
  staleReasons: z.array(StaleReason),
  revision: z.number().int(),
  wordCount: z.number().int(),
  versionCount: z.number().int(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Chapter = z.infer<typeof Chapter>;

export const SceneCreate = z.object({
  title: RequiredName,
  summary: OptionalText,
  goal: OptionalText,
  povCharacterId: Id.nullable().optional(),
  locationId: Id.nullable().optional(),
  plotPointIds: z.array(Id).max(200).optional(),
});
export type SceneCreate = z.infer<typeof SceneCreate>;

export const SceneUpdate = SceneCreate.partial();
export type SceneUpdate = z.infer<typeof SceneUpdate>;

export const Scene = z.object({
  id: Id,
  chapterId: Id,
  projectId: Id,
  sortOrder: z.number().int(),
  title: z.string(),
  summary: z.string().nullable(),
  goal: z.string().nullable(),
  povCharacterId: Id.nullable(),
  locationId: Id.nullable(),
  plotPointIds: z.array(Id),
  currentVersionId: Id.nullable(),
  staleLevel: StaleLevel,
  staleReasons: z.array(StaleReason),
  revision: z.number().int(),
  wordCount: z.number().int(),
  versionCount: z.number().int(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Scene = z.infer<typeof Scene>;

export const GeneratedVersion = z.object({
  id: Id,
  projectId: Id,
  targetType: VersionTargetType,
  targetId: Id,
  runId: Id.nullable(),
  versionNo: z.number().int(),
  content: z.string(),
  wordCount: z.number().int(),
  instructions: z.string().nullable(),
  parentVersionId: Id.nullable(),
  bibleHash: z.string().nullable(),
  stopReason: StopReason.nullable(),
  isCurrent: z.boolean(),
  createdAt: z.number().int(),
});
export type GeneratedVersion = z.infer<typeof GeneratedVersion>;

/** A hand-written or hand-edited version, saved without calling a model. */
export const ManualVersionCreate = z.object({
  targetType: VersionTargetType,
  targetId: Id,
  content: z.string().max(2_000_000),
  instructions: OptionalText,
});
export type ManualVersionCreate = z.infer<typeof ManualVersionCreate>;

export const VersionDiffLine = z.object({
  type: z.enum(['added', 'removed', 'unchanged']),
  value: z.string(),
});
export type VersionDiffLine = z.infer<typeof VersionDiffLine>;
