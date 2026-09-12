import { z } from 'zod';
import { RevisableEntityType } from '../enums.js';
import { Id } from './common.js';

export const EntityRevision = z.object({
  id: Id,
  projectId: Id,
  entityType: RevisableEntityType,
  entityId: Id,
  revision: z.number().int(),
  summary: z.string(),
  deleted: z.boolean(),
  createdAt: z.number().int(),
});
export type EntityRevision = z.infer<typeof EntityRevision>;

export const EntityRevisionDetail = EntityRevision.extend({
  snapshot: z.record(z.unknown()),
  previousSnapshot: z.record(z.unknown()).nullable(),
  changedFields: z.array(z.string()),
});
export type EntityRevisionDetail = z.infer<typeof EntityRevisionDetail>;
