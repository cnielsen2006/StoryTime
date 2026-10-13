import { z } from 'zod';
import { Id } from './common.js';

/**
 * Who says each quoted passage in one version of the text, so the reader can
 * give every speaker their own voice. Positions are per paragraph (as cut by
 * splitParagraphs) and the list is in reading order, so the speaker of a quote
 * can be corrected by index without re-finding anything.
 */
export const DialogueQuote = z.object({
  paragraph: z.number().int().min(0),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  /** The character speaking, or null for the narrator's voice (unknown or unnamed speakers). */
  speaker: Id.nullable(),
});
export type DialogueQuote = z.infer<typeof DialogueQuote>;

export const DialogueAttribution = z.object({
  versionId: Id,
  /** The character telling the story in first person. Null when the narration is third person. */
  narratorId: Id.nullable(),
  quotes: z.array(DialogueQuote),
  /** 'manual' once the author has corrected it, so a re-run does not overwrite their work. */
  source: z.enum(['model', 'manual']),
  createdAt: z.number().int(),
  updatedAt: z.number().int(),
});
export type DialogueAttribution = z.infer<typeof DialogueAttribution>;

export const DialogueResponse = z.object({
  attribution: DialogueAttribution.nullable(),
});
export type DialogueResponse = z.infer<typeof DialogueResponse>;

/** Author corrections: speakers aligned with the stored quotes, plus the narrator. */
export const DialogueUpdate = z.object({
  narratorId: Id.nullable(),
  speakers: z.array(Id.nullable()).max(20_000),
});
export type DialogueUpdate = z.infer<typeof DialogueUpdate>;

// --- What the model returns --------------------------------------------------

export const DialogueSpeaker = z.object({
  quote: z.number().describe('The number n from the ⟦n⟧ marker in front of the quote.'),
  characterId: z
    .string()
    .describe('Tag id of the character speaking, copied exactly from the cast list. Empty string if nobody on the list.'),
});

export const DialogueAttributionResult = z.object({
  narratorId: z
    .string()
    .describe(
      'Tag id of the character telling the story when the narration is first person ("I", "we"). Empty string for third person.',
    ),
  speakers: z.array(DialogueSpeaker).describe('One entry for every numbered quote that appears in the text, in order.'),
});
export type DialogueAttributionResult = z.infer<typeof DialogueAttributionResult>;
