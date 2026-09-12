import { z } from 'zod';
import { CharacterRole } from '../enums.js';
import { Id, OptionalText, RequiredName } from './common.js';

/** One ordered life event. Stored as a child of the character and snapshotted with it. */
export const CharacterExperienceInput = z.object({
  id: Id.optional(),
  whenLabel: OptionalText,
  title: RequiredName,
  description: OptionalText,
  impact: OptionalText,
});
export type CharacterExperienceInput = z.infer<typeof CharacterExperienceInput>;

export const CharacterExperience = z.object({
  id: Id,
  characterId: Id,
  sortOrder: z.number().int(),
  whenLabel: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  impact: z.string().nullable(),
});
export type CharacterExperience = z.infer<typeof CharacterExperience>;

export const CharacterCreate = z.object({
  name: RequiredName,
  role: CharacterRole.default('supporting'),
  description: OptionalText,
  appearance: OptionalText,
  personality: OptionalText,
  backstory: OptionalText,
  arcNotes: OptionalText,
  experiences: z.array(CharacterExperienceInput).max(200).optional(),
});
export type CharacterCreate = z.infer<typeof CharacterCreate>;

export const CharacterUpdate = CharacterCreate.partial();
export type CharacterUpdate = z.infer<typeof CharacterUpdate>;

export const Character = z.object({
  id: Id,
  projectId: Id,
  name: z.string(),
  role: CharacterRole,
  description: z.string().nullable(),
  appearance: z.string().nullable(),
  personality: z.string().nullable(),
  backstory: z.string().nullable(),
  arcNotes: z.string().nullable(),
  sortOrder: z.number().int(),
  revision: z.number().int(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Character = z.infer<typeof Character>;

export const CharacterDetail = Character.extend({
  experiences: z.array(CharacterExperience),
});
export type CharacterDetail = z.infer<typeof CharacterDetail>;

export const ExperiencesReplace = z.object({
  experiences: z.array(CharacterExperienceInput).max(200),
});
export type ExperiencesReplace = z.infer<typeof ExperiencesReplace>;

export const RelationshipCreate = z.object({
  fromCharacterId: Id,
  toCharacterId: Id,
  kind: RequiredName,
  description: OptionalText,
});
export type RelationshipCreate = z.infer<typeof RelationshipCreate>;

export const RelationshipUpdate = RelationshipCreate.partial();
export type RelationshipUpdate = z.infer<typeof RelationshipUpdate>;

export const Relationship = z.object({
  id: Id,
  projectId: Id,
  fromCharacterId: Id,
  toCharacterId: Id,
  kind: z.string(),
  description: z.string().nullable(),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type Relationship = z.infer<typeof Relationship>;
