import { z } from 'zod';
import { Effort, ProviderId } from '../enums.js';
import { Id, OptionalText, RequiredName } from './common.js';

export const ProjectCreate = z.object({
  title: RequiredName,
  description: OptionalText,
  provider: ProviderId.nullable().optional(),
  model: z.string().trim().max(200).nullable().optional(),
  effort: Effort.nullable().optional(),
  tokenBudget: z.number().int().min(1000).max(2_000_000).nullable().optional(),
});
export type ProjectCreate = z.infer<typeof ProjectCreate>;

export const ProjectUpdate = ProjectCreate.partial();
export type ProjectUpdate = z.infer<typeof ProjectUpdate>;

export const Project = z.object({
  id: Id,
  title: z.string(),
  description: z.string().nullable(),
  provider: ProviderId.nullable(),
  model: z.string().nullable(),
  effort: Effort.nullable(),
  tokenBudget: z.number().int().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Project = z.infer<typeof Project>;

export const StoryParametersUpdate = z.object({
  audience: OptionalText,
  targetLengthWords: z.number().int().min(100).max(500_000).nullable().optional(),
  genre: OptionalText,
  tone: OptionalText,
  pov: OptionalText,
  tense: OptionalText,
  styleNotes: OptionalText,
  contentGuidelines: OptionalText,
  comparableTitles: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
});
export type StoryParametersUpdate = z.infer<typeof StoryParametersUpdate>;

export const StoryParameters = z.object({
  id: Id,
  projectId: Id,
  audience: z.string().nullable(),
  targetLengthWords: z.number().int().nullable(),
  genre: z.string().nullable(),
  tone: z.string().nullable(),
  pov: z.string().nullable(),
  tense: z.string().nullable(),
  styleNotes: z.string().nullable(),
  contentGuidelines: z.string().nullable(),
  comparableTitles: z.array(z.string()),
  revision: z.number().int(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type StoryParameters = z.infer<typeof StoryParameters>;
