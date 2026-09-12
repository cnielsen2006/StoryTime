import { z } from 'zod';

/**
 * Structured outputs the model is asked to produce. These double as the
 * response-format schema for every provider, so keep them flat, use plain
 * types, and describe each field: the descriptions are the only instructions
 * the model gets about the shape.
 */

export const OutlineScene = z.object({
  title: z.string().describe('Short scene title.'),
  goal: z.string().describe('What this scene must accomplish in one sentence.'),
  povCharacterId: z
    .string()
    .describe('Character tag id for the point-of-view character, e.g. "ab12". Empty string if unspecified.'),
  locationId: z.string().describe('Location tag id where the scene takes place. Empty string if unspecified.'),
  beats: z.array(z.string()).describe('Ordered beats that happen in this scene.'),
  plotPointIds: z.array(z.string()).describe('Plot point tag ids this scene covers.'),
  estimatedWords: z.number().describe('Rough target word count for this scene.'),
});
export type OutlineScene = z.infer<typeof OutlineScene>;

export const OutlineChapter = z.object({
  title: z.string().describe('Chapter title.'),
  summary: z.string().describe('What happens in this chapter, 2-4 sentences.'),
  plotPointIds: z.array(z.string()).describe('Plot point tag ids this chapter covers.'),
  characterIds: z.array(z.string()).describe('Character tag ids who appear.'),
  locationIds: z.array(z.string()).describe('Location tag ids used.'),
  estimatedWords: z.number().describe('Rough target word count for this chapter.'),
  scenes: z.array(OutlineScene).describe('Scenes in order. Empty array when scenes were not requested.'),
});
export type OutlineChapter = z.infer<typeof OutlineChapter>;

export const OutlineResult = z.object({
  chapters: z.array(OutlineChapter).describe('Chapters in reading order.'),
});
export type OutlineResult = z.infer<typeof OutlineResult>;

export const ChapterSummaryResult = z.object({
  summary: z.string().describe('What happened, 2-4 sentences, past tense, for continuity.'),
  openThreads: z.array(z.string()).describe('Unresolved questions or promises a later chapter must pay off.'),
});
export type ChapterSummaryResult = z.infer<typeof ChapterSummaryResult>;

export const TriageSuggestionLink = z.object({
  entityType: z
    .enum(['character', 'location', 'plot_line', 'plot_point', 'story_parameters'])
    .describe('What kind of thing this idea belongs to.'),
  entityId: z.string().describe('Tag id of an existing entity, or empty string to propose a new one.'),
  newEntityName: z.string().describe('Name for a new entity when entityId is empty, else empty string.'),
  note: z.string().describe('One sentence on how the idea applies to that entity.'),
});
export type TriageSuggestionLink = z.infer<typeof TriageSuggestionLink>;

export const TriageResult = z.object({
  links: z.array(TriageSuggestionLink).describe('Where this idea should be filed. One to three entries.'),
});
export type TriageResult = z.infer<typeof TriageResult>;
