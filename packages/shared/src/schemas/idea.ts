import { z } from 'zod';
import { IdeaStatus, LinkableEntityType } from '../enums.js';
import { Id, OptionalText } from './common.js';

export const IdeaCreate = z.object({
  text: z.string().trim().min(1, 'An idea needs some text').max(10000),
});
export type IdeaCreate = z.infer<typeof IdeaCreate>;

export const IdeaUpdate = z.object({
  text: z.string().trim().min(1).max(10000).optional(),
  status: IdeaStatus.optional(),
});
export type IdeaUpdate = z.infer<typeof IdeaUpdate>;

export const IdeaLinkCreate = z.object({
  entityType: LinkableEntityType,
  entityId: Id,
  note: OptionalText,
});
export type IdeaLinkCreate = z.infer<typeof IdeaLinkCreate>;

export const IdeaLink = z.object({
  id: Id,
  ideaId: Id,
  entityType: LinkableEntityType,
  entityId: Id,
  entityLabel: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.number().int(),
});
export type IdeaLink = z.infer<typeof IdeaLink>;

export const Idea = z.object({
  id: Id,
  projectId: Id,
  text: z.string(),
  status: IdeaStatus,
  links: z.array(IdeaLink),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Idea = z.infer<typeof Idea>;

/** Turn an idea straight into a new entity, carrying the text across. */
export const IdeaPromote = z.object({
  entityType: z.enum(['character', 'location', 'plot_line', 'plot_point']),
  name: z.string().trim().min(1).max(200),
  plotLineId: Id.optional(),
});
export type IdeaPromote = z.infer<typeof IdeaPromote>;
