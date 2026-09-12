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

// --- Seeding a whole new project from a premise -----------------------------

export const SeedExperience = z.object({
  whenLabel: z.string().describe('Roughly when this happened, e.g. "Age nine" or "Two winters ago".'),
  title: z.string().describe('Short name for the event.'),
  description: z.string().describe('What happened, one or two sentences.'),
  impact: z.string().describe('What it left the character with: a belief, a fear, a habit.'),
});
export type SeedExperience = z.infer<typeof SeedExperience>;

export const SeedCharacter = z.object({
  name: z.string().describe('Full name as it appears in the book.'),
  role: z.enum(['protagonist', 'antagonist', 'supporting', 'minor']).describe('Their place in the story.'),
  description: z.string().describe('Who they are in two or three sentences.'),
  appearance: z.string().describe('What someone notices looking at them. Concrete, not a catalogue.'),
  personality: z.string().describe('How they behave and speak. Include a flaw.'),
  backstory: z.string().describe('What happened before page one that still matters.'),
  arcNotes: z.string().describe('Where they start and where they end up.'),
  experiences: z.array(SeedExperience).describe('Two to four formative events, oldest first.'),
});
export type SeedCharacter = z.infer<typeof SeedCharacter>;

export const SeedRelationship = z.object({
  fromCharacter: z.string().describe('Name of the first character, matching one in the cast exactly.'),
  toCharacter: z.string().describe('Name of the second character, matching one in the cast exactly.'),
  kind: z.string().describe('The relationship in a few words, e.g. "reluctant ally".'),
  description: z.string().describe('What is unresolved or charged between them.'),
});
export type SeedRelationship = z.infer<typeof SeedRelationship>;

export const SeedLocation = z.object({
  name: z.string().describe('Name of the place.'),
  description: z.string().describe('What it is and why it matters to the story.'),
  sensoryDetails: z.string().describe('Sound, smell, texture, light. What a character notices without looking.'),
  rulesLore: z.string().describe('What is true here that is not true elsewhere. Empty string if nothing.'),
});
export type SeedLocation = z.infer<typeof SeedLocation>;

export const SeedPlotPoint = z.object({
  title: z.string().describe('What happens, as a short phrase.'),
  summary: z.string().describe('The beat in one or two sentences.'),
  status: z
    .enum(['idea', 'draft', 'confirmed'])
    .describe('How settled this beat is. Early structural beats are confirmed; later or looser ones are draft or idea.'),
  characters: z.array(z.string()).describe('Names of characters involved, matching the cast exactly.'),
  locations: z.array(z.string()).describe('Names of locations involved, matching the location list exactly.'),
});
export type SeedPlotPoint = z.infer<typeof SeedPlotPoint>;

export const SeedPlotLine = z.object({
  name: z.string().describe('Name of this thread.'),
  description: z.string().describe('What this thread is about.'),
  kind: z.enum(['main', 'subplot', 'backstory']).describe('Whether this is the spine, a subplot, or backstory.'),
  points: z.array(SeedPlotPoint).describe('Beats in order along this thread.'),
});
export type SeedPlotLine = z.infer<typeof SeedPlotLine>;

export const SeedStoryParameters = z.object({
  audience: z.string().describe('Who this is for, e.g. "Adult" or "Young adult, 14 and up".'),
  genre: z.string().describe('Genre, specific rather than generic.'),
  tone: z.string().describe('The feel of the prose in a phrase or two.'),
  pov: z.string().describe('Point of view, naming the viewpoint character where there is one.'),
  tense: z.string().describe('Past tense or present tense.'),
  targetLengthWords: z.number().describe('Target manuscript length in words.'),
  styleNotes: z.string().describe('Concrete prose guidance: sentence rhythm, habits to avoid.'),
  contentGuidelines: z.string().describe('Hard limits appropriate to the audience.'),
  comparableTitles: z.array(z.string()).describe('Two or three real comparable books.'),
});
export type SeedStoryParameters = z.infer<typeof SeedStoryParameters>;

/**
 * A complete starting story bible. The model invents the premise and cast; the
 * server turns this into real rows, resolving the name references above into
 * database ids.
 */
export const SeedProjectResult = z.object({
  title: z.string().describe('Title of the book.'),
  premise: z.string().describe('The hook in one or two sentences.'),
  storyParameters: SeedStoryParameters,
  characters: z.array(SeedCharacter).describe('The cast, protagonist first.'),
  relationships: z.array(SeedRelationship).describe('Charged connections between cast members.'),
  locations: z.array(SeedLocation).describe('Places the story happens.'),
  plotLines: z.array(SeedPlotLine).describe('One main thread plus one or two subplots.'),
  openQuestions: z
    .array(z.string())
    .describe('Things deliberately left undecided, for the author to resolve. These land in the inbox.'),
});
export type SeedProjectResult = z.infer<typeof SeedProjectResult>;
