import { z } from 'zod';
import { Id, OptionalText, RequiredName } from './common.js';

export const LocationCreate = z.object({
  name: RequiredName,
  description: OptionalText,
  sensoryDetails: OptionalText,
  rulesLore: OptionalText,
});
export type LocationCreate = z.infer<typeof LocationCreate>;

export const LocationUpdate = LocationCreate.partial();
export type LocationUpdate = z.infer<typeof LocationUpdate>;

export const Location = z.object({
  id: Id,
  projectId: Id,
  name: z.string(),
  description: z.string().nullable(),
  sensoryDetails: z.string().nullable(),
  rulesLore: z.string().nullable(),
  sortOrder: z.number().int(),
  revision: z.number().int(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Location = z.infer<typeof Location>;
