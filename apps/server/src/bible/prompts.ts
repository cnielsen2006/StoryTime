import type { Chapter, GenerationMode, Scene, StoryParameters } from '@storytime/shared';

/**
 * The system prompt is identical for every request in a run so the provider can
 * cache it. Anything that varies per chapter belongs in the task message.
 */
export function buildSystemPrompt(bibleMarkdown: string, params: StoryParameters): string {
  const rules: string[] = [
    'You are a novelist drafting a book from the story bible below. Write finished prose, not notes, outlines, or commentary.',
    '',
    'Rules:',
    '- The story bible is the source of truth. Do not rename characters or places, and do not contradict established facts.',
    '- You may invent small concrete details (a gesture, a smell, a passing remark) where the bible is silent. Do not invent new named characters or locations.',
    '- Write scenes, not summaries. Prefer action and dialogue over narrated recap.',
  ];

  if (params.pov?.trim()) rules.push(`- Point of view: ${params.pov.trim()}. Hold it consistently.`);
  if (params.tense?.trim()) rules.push(`- Tense: ${params.tense.trim()}. Hold it consistently.`);
  if (params.audience?.trim()) rules.push(`- Intended audience: ${params.audience.trim()}. Match vocabulary and subject matter to it.`);
  if (params.tone?.trim()) rules.push(`- Tone: ${params.tone.trim()}.`);
  if (params.styleNotes?.trim()) rules.push(`- Style: ${params.styleNotes.trim()}`);
  if (params.contentGuidelines?.trim()) {
    rules.push(`- Content guidelines, which override everything above: ${params.contentGuidelines.trim()}`);
  }

  rules.push(
    '- Output only the prose itself. No preamble, no "Here is", no notes about what you did, no word count.',
    '',
    'The bracketed tags after names, like [C:ab12], are internal ids. Never write them in your prose.',
  );

  return `${rules.join('\n')}\n\n${bibleMarkdown}`;
}

function wordTarget(words: number | null | undefined, fallback: number): string {
  const target = words && words > 0 ? words : fallback;
  return `~${target.toLocaleString()} words`;
}

export interface DraftPromptInput {
  targetWords: number | null;
  chapterCountHint: number | null;
  instructions?: string | null;
}

/** Mode (a): the whole book in one pass. */
export function buildDraftPrompt(input: DraftPromptInput): string {
  const chapters = input.chapterCountHint
    ? `Divide it into about ${input.chapterCountHint} chapters.`
    : 'Divide it into chapters of a natural length.';
  const lines = [
    `Write the complete manuscript, ${wordTarget(input.targetWords, 5000)} in total. ${chapters}`,
    'Work through the confirmed plot points in order, weaving in the subplots where they belong.',
    'Start each chapter with a heading in exactly this form, on its own line:',
    '',
    '## Chapter 1: The Title',
    '',
    'Then write the chapter prose beneath it.',
  ];
  if (input.instructions?.trim()) {
    lines.push('', `Additional direction from the author: ${input.instructions.trim()}`);
  }
  return lines.join('\n');
}

/** Continuation when a draft hits the output ceiling mid-sentence. */
export function buildContinuationPrompt(): string {
  return 'Continue the manuscript from exactly where you stopped. Do not repeat any text you already wrote, do not summarise what came before, and do not add a preamble. Pick up mid-sentence if that is where you stopped.';
}

export interface OutlinePromptInput {
  mode: GenerationMode;
  targetWords: number | null;
  chapterCountHint: number | null;
  instructions?: string | null;
}

/** Mode (b) and (c): plan the book before writing a word of it. */
export function buildOutlinePrompt(input: OutlinePromptInput): string {
  const chapters = input.chapterCountHint
    ? `Plan about ${input.chapterCountHint} chapters.`
    : 'Choose a chapter count that suits the material.';
  const lines = [
    `Plan the book as a chapter outline. ${chapters} The finished book should run ${wordTarget(input.targetWords, 50_000)}.`,
    '',
    'For each chapter give a title, a summary of 2 to 4 sentences, the plot point ids it covers, the character ids who appear, the location ids used, and an estimated word count. The estimated word counts should add up to roughly the target length.',
    '',
    'Use the bracketed tag ids exactly as they appear in the story bible: character ids from [C:...], location ids from [L:...], plot point ids from [PP:...]. Use only ids that appear in the bible. Cover every confirmed plot point somewhere in the outline.',
  ];

  if (input.mode === 'scenes') {
    lines.push(
      '',
      'Also break each chapter into 2 to 5 scenes. For each scene give a title, a one-sentence goal, the point-of-view character id, the location id, the ordered beats, the plot point ids it covers, and an estimated word count.',
    );
  } else {
    lines.push('', 'Leave the scenes array empty for every chapter.');
  }

  if (input.instructions?.trim()) {
    lines.push('', `Additional direction from the author: ${input.instructions.trim()}`);
  }
  return lines.join('\n');
}

export interface ChapterPromptInput {
  chapter: Chapter;
  index: number;
  total: number;
  targetWords: number | null;
  plotPointTitles: string[];
  /** Summaries of everything already written, oldest first. */
  priorSummaries: Array<{ title: string; summary: string }>;
  /** Verbatim tail of the previous chapter so the voice carries over. */
  previousTail: string | null;
  instructions?: string | null;
}

/** Mode (b): one chapter at a time, with continuity from what came before. */
export function buildChapterPrompt(input: ChapterPromptInput): string {
  const lines: string[] = [];

  if (input.priorSummaries.length > 0) {
    lines.push('## The story so far');
    for (const prior of input.priorSummaries) {
      lines.push(`- **${prior.title}:** ${prior.summary}`);
    }
    lines.push('');
  }

  if (input.previousTail?.trim()) {
    lines.push('## How the previous chapter ended', '', input.previousTail.trim(), '');
  }

  lines.push(`## Write chapter ${input.index + 1} of ${input.total}: ${input.chapter.title}`, '');
  if (input.chapter.summary?.trim()) {
    lines.push(`What this chapter needs to do: ${input.chapter.summary.trim()}`, '');
  }
  if (input.plotPointTitles.length > 0) {
    lines.push('Plot points to cover:');
    for (const title of input.plotPointTitles) lines.push(`- ${title}`);
    lines.push('');
  }

  lines.push(
    `Write ${wordTarget(input.targetWords, 2500)} of finished prose.`,
    'Do not write a chapter heading; the chapter title is stored separately.',
    'Do not resolve threads this chapter is not responsible for.',
  );

  if (input.instructions?.trim()) {
    lines.push('', `Additional direction from the author: ${input.instructions.trim()}`);
  }
  return lines.join('\n');
}

export interface ScenePromptInput {
  scene: Scene;
  chapter: Chapter;
  index: number;
  total: number;
  targetWords: number | null;
  povName: string | null;
  locationName: string | null;
  plotPointTitles: string[];
  previousTail: string | null;
  nextGoal: string | null;
  instructions?: string | null;
}

/** Mode (c): one scene at a time, the finest grain. */
export function buildScenePrompt(input: ScenePromptInput): string {
  const lines: string[] = [];

  if (input.chapter.summary?.trim()) {
    lines.push(`## The chapter this scene belongs to: ${input.chapter.title}`, '', input.chapter.summary.trim(), '');
  }

  if (input.previousTail?.trim()) {
    lines.push('## How the previous scene ended', '', input.previousTail.trim(), '');
  }

  lines.push(`## Write scene ${input.index + 1} of ${input.total}: ${input.scene.title}`, '');
  if (input.scene.goal?.trim()) lines.push(`Goal of this scene: ${input.scene.goal.trim()}`);
  if (input.povName) lines.push(`Point of view: ${input.povName}`);
  if (input.locationName) lines.push(`Setting: ${input.locationName}`);
  if (input.scene.summary?.trim()) lines.push(`Beats: ${input.scene.summary.trim()}`);
  if (input.plotPointTitles.length > 0) {
    lines.push('', 'Plot points to cover:');
    for (const title of input.plotPointTitles) lines.push(`- ${title}`);
  }

  lines.push(
    '',
    `Write ${wordTarget(input.targetWords, 900)} of finished prose.`,
    'Do not write a heading. Start in the scene.',
  );

  if (input.nextGoal?.trim()) {
    lines.push(
      '',
      `The next scene begins with: ${input.nextGoal.trim()}. End this scene somewhere that hands off to it cleanly, without covering it yourself.`,
    );
  }

  if (input.instructions?.trim()) {
    lines.push('', `Additional direction from the author: ${input.instructions.trim()}`);
  }
  return lines.join('\n');
}

export interface UpdatePromptInput {
  label: string;
  priorText: string;
  instructions: string;
}

/**
 * Revision rather than regeneration: the prior text is the baseline and the
 * instructions are the only licence to change it.
 */
export function buildUpdatePrompt(input: UpdatePromptInput): string {
  return [
    `Below is the current text of ${input.label}, followed by the author's revision instructions.`,
    '',
    'Rewrite the text to satisfy the instructions. Keep everything the instructions do not ask you to change as close to the original as you can: same events, same voice, same sentences where they still work. This is a revision, not a fresh draft.',
    '',
    'Output only the revised prose.',
    '',
    '<current_text>',
    input.priorText.trim(),
    '</current_text>',
    '',
    '<instructions>',
    input.instructions.trim(),
    '</instructions>',
  ].join('\n');
}

/** Cheap follow-up call that keeps later chapters coherent. */
export function buildSummaryPrompt(label: string, text: string): string {
  return [
    `Summarise ${label} for continuity, so the next chapter can be written without re-reading it.`,
    '',
    'Give a summary of 2 to 4 sentences in past tense covering what actually happened, and list any threads left open that a later chapter must pay off.',
    '',
    '<text>',
    text.slice(-12_000).trim(),
    '</text>',
  ].join('\n');
}

/** Optional helper for filing a raw inbox idea. */
export function buildTriagePrompt(ideaText: string): string {
  return [
    'An author captured this loose idea. Decide where it belongs in the story bible.',
    '',
    'Return one to three links. For each, give the entity type, the existing entity id from the bible tags if one fits, or an empty id and a proposed name for a new entity if nothing fits, plus one sentence on how the idea applies.',
    '',
    '<idea>',
    ideaText.trim(),
    '</idea>',
  ].join('\n');
}
