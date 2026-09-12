import { z } from 'zod';
import { BibleLevel, Effort, GenerationMode, ProviderId, RunKind, RunStatus, VersionTargetType } from '../enums.js';
import { Id, OptionalText } from './common.js';

export const RunCreate = z
  .object({
    mode: GenerationMode,
    kind: RunKind,
    /** Which chapters or scenes to write. Empty means "all that need it". */
    targetIds: z.array(Id).max(500).optional(),
    /** For kind=update: the single thing being revised. */
    targetType: VersionTargetType.optional(),
    targetId: Id.optional(),
    instructions: OptionalText,
    effort: Effort.optional(),
    targetLengthWords: z.number().int().min(100).max(500_000).nullable().optional(),
    chapterCountHint: z.number().int().min(1).max(200).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.kind === 'update') {
      if (!value.targetType || !value.targetId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'An update run needs targetType and targetId.',
          path: ['targetId'],
        });
      }
      if (!value.instructions) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'An update run needs instructions describing the revision.',
          path: ['instructions'],
        });
      }
    }
    if (value.kind === 'outline' && value.mode === 'draft') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Whole-draft mode does not use an outline step.',
        path: ['kind'],
      });
    }
  });
export type RunCreate = z.infer<typeof RunCreate>;

export const TrimReport = z.object({
  level: BibleLevel,
  estimatedTokens: z.number().int(),
  budgetTokens: z.number().int(),
  notes: z.array(z.string()),
});
export type TrimReport = z.infer<typeof TrimReport>;

export const RunPreview = z.object({
  mode: GenerationMode,
  kind: RunKind,
  provider: ProviderId,
  model: z.string(),
  effort: Effort,
  targetCount: z.number().int(),
  targetLabels: z.array(z.string()),
  systemPrompt: z.string(),
  taskPrompt: z.string(),
  trim: TrimReport,
  warnings: z.array(z.string()),
});
export type RunPreview = z.infer<typeof RunPreview>;

export const GenerationRun = z.object({
  id: Id,
  projectId: Id,
  mode: GenerationMode,
  kind: RunKind,
  targetType: VersionTargetType.nullable(),
  targetId: Id.nullable(),
  provider: ProviderId,
  model: z.string(),
  effort: Effort,
  instructions: z.string().nullable(),
  status: RunStatus,
  bibleHash: z.string().nullable(),
  estimatedInputTokens: z.number().int().nullable(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  cacheReadTokens: z.number().int().nullable(),
  error: z.string().nullable(),
  startedAt: z.number().int().nullable(),
  finishedAt: z.number().int().nullable(),
  createdAt: z.number().int(),
});
export type GenerationRun = z.infer<typeof GenerationRun>;

export const RunDetail = GenerationRun.extend({
  bibleMarkdown: z.string().nullable(),
});
export type RunDetail = z.infer<typeof RunDetail>;
