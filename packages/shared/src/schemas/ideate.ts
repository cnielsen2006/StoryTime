import { z } from 'zod';
import { Effort, ProviderId } from '../enums.js';
import { Id, OptionalText } from './common.js';

/**
 * Starting points offered in the UI. The prompt hint steers the model without
 * narrowing it to one plot, so asking twice gives two different books.
 */
export const STORY_CATEGORIES = [
  {
    id: 'fantasy',
    label: 'Fantasy',
    hint: 'A world with its own rules, where the magic costs something and the cost is the point.',
  },
  {
    id: 'science-fiction',
    label: 'Science fiction',
    hint: 'A premise that changes one thing about how people live, then follows the consequences honestly.',
  },
  {
    id: 'mystery',
    label: 'Mystery',
    hint: 'A question worth answering, a detective with a reason to care, and a solution that reframes what came before.',
  },
  {
    id: 'thriller',
    label: 'Thriller',
    hint: 'Pressure that keeps rising, a clock that keeps running, and a protagonist out of good options.',
  },
  {
    id: 'literary',
    label: 'Literary fiction',
    hint: 'Ordinary lives under close attention, where the drama is internal and the prose carries the weight.',
  },
  {
    id: 'historical',
    label: 'Historical fiction',
    hint: 'A real period rendered specifically, with characters whose problems belong to their time.',
  },
  {
    id: 'horror',
    label: 'Horror',
    hint: 'Dread built slowly from something ordinary, where what is implied outlasts what is shown.',
  },
  {
    id: 'romance',
    label: 'Romance',
    hint: 'Two people with a real reason to stay apart and a better reason not to.',
  },
  {
    id: 'adventure',
    label: 'Adventure',
    hint: 'A journey with a destination worth reaching and a cost for reaching it.',
  },
  {
    id: 'childrens',
    label: "Children's",
    hint: 'A small protagonist facing something big, told plainly, funny where it can be and never condescending.',
  },
  {
    id: 'young-adult',
    label: 'Young adult',
    hint: 'A teenager whose choice actually matters, in a voice that does not perform being young.',
  },
  {
    id: 'surprise',
    label: 'Surprise me',
    hint: 'Pick any genre you like, including one that mixes two. Choose something you find interesting rather than the obvious option.',
  },
] as const;

export type StoryCategoryId = (typeof STORY_CATEGORIES)[number]['id'];

export const StoryCategory = z.enum(
  STORY_CATEGORIES.map((c) => c.id) as [StoryCategoryId, ...StoryCategoryId[]],
);

export const AUDIENCE_OPTIONS = [
  { id: 'any', label: 'Let the model choose' },
  { id: 'children', label: "Children, 8 to 12" },
  { id: 'young-adult', label: 'Young adult, 14 and up' },
  { id: 'adult', label: 'Adult' },
] as const;

export const SeedAudience = z.enum(['any', 'children', 'young-adult', 'adult']);
export type SeedAudience = z.infer<typeof SeedAudience>;

export const SEED_SIZES = [
  { id: 'small', label: 'Small', detail: '2 characters, 2 places, 1 thread' },
  { id: 'medium', label: 'Medium', detail: '3 to 4 characters, 3 places, 2 threads' },
  { id: 'large', label: 'Large', detail: '5 to 6 characters, 4 to 5 places, 3 threads' },
] as const;

export const SeedSize = z.enum(['small', 'medium', 'large']);
export type SeedSize = z.infer<typeof SeedSize>;

export const SeedProjectRequest = z.object({
  category: StoryCategory,
  audience: SeedAudience.default('any'),
  size: SeedSize.default('medium'),
  /** Optional steer: a setting, an image, a first line, anything. */
  premise: OptionalText,
  targetLengthWords: z.number().int().min(1000).max(500_000).nullable().optional(),
  /** Which provider to invent with. Falls back to the global default. */
  provider: ProviderId.optional(),
  model: z.string().trim().max(200).optional(),
  effort: Effort.optional(),
});
export type SeedProjectRequest = z.infer<typeof SeedProjectRequest>;

export const SeedProjectResponse = z.object({
  projectId: Id,
  title: z.string(),
  premise: z.string(),
  counts: z.object({
    characters: z.number().int(),
    locations: z.number().int(),
    plotLines: z.number().int(),
    plotPoints: z.number().int(),
    ideas: z.number().int(),
  }),
  warnings: z.array(z.string()),
});
export type SeedProjectResponse = z.infer<typeof SeedProjectResponse>;
