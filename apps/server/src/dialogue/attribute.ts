import {
  DialogueAttributionResult,
  findQuotes,
  splitParagraphs,
  type CharacterDetail,
  type DialogueAttribution,
  type DialogueQuote,
  type StoryParameters,
} from '@storytime/shared';
import type { Db } from '../db/client.js';
import type { LlmProvider, Usage } from '../llm/types.js';
import { readVersion } from '../services/manuscript.js';
import { readAttribution, saveAttribution } from './store.js';

/** Characters per request. A long chapter is attributed in windows rather than in one oversized prompt. */
const WINDOW_CHARS = 60_000;
/** With no dialogue to mark, a sample of the opening is enough to tell who is narrating. */
const NARRATOR_SAMPLE_CHARS = 6_000;

export interface AttributionContext {
  provider: LlmProvider;
  model: string;
  characters: CharacterDetail[];
  storyParameters: Pick<StoryParameters, 'pov' | 'tense'>;
}

export interface AttributeOptions {
  db: Db;
  ctx: AttributionContext;
  projectId: string;
  versionId: string;
  signal: AbortSignal;
  /** The viewpoint character when the text is a scene with one set. */
  povCharacterId?: string | null;
  /** Redo a version that already has voices, including one the author corrected. */
  force?: boolean;
}

export interface AttributeOutcome {
  attribution: DialogueAttribution | null;
  usage: Usage;
  /** True when voices already existed and were left alone. */
  skipped: boolean;
}

interface FoundQuote {
  paragraph: number;
  start: number;
  end: number;
}

function castList(characters: CharacterDetail[]): string {
  return characters
    .map((c) => {
      const about = (c.description ?? c.personality ?? '').replace(/\s+/g, ' ').trim().slice(0, 160);
      return `- ${c.name} [C:${c.id}] (${c.role})${about ? `: ${about}` : ''}`;
    })
    .join('\n');
}

export function buildAttributionSystemPrompt(
  characters: CharacterDetail[],
  params: Pick<StoryParameters, 'pov' | 'tense'>,
  povName: string | null,
): string {
  const lines = [
    'You mark who speaks in a piece of fiction so that each speaker can be given their own voice when it is read aloud.',
    '',
    "The author's cast:",
    castList(characters),
    '',
    `Story point of view: ${params.pov?.trim() || 'not specified'}.`,
  ];
  if (povName) lines.push(`This text is told from the point of view of ${povName}.`);
  lines.push(
    '',
    'Every quoted passage in the text is preceded by a marker like ⟦12⟧. For each marker, name the cast member who speaks that passage.',
    '',
    'Rules:',
    '- Use dialogue tags ("said Mara"), actions beside the quote, who was just addressed, and turn-taking. An untagged exchange between two people alternates between them.',
    '- A quote that carries on into the next paragraph keeps the same speaker.',
    '- Use an empty characterId when the speaker is not on the cast list (a crowd, a stranger, a voice on a radio, words read from a page) or genuinely cannot be told.',
    '- Scare quotes, titles, and words that are mentioned rather than spoken are not speech: use an empty characterId.',
    '- narratorId: when the narration is first person, the cast member who is the "I" (or "we"). Otherwise an empty string.',
    '- Copy ids exactly as they appear after "C:" inside the brackets, without the brackets.',
    '- Return an entry for every marker present in the text, and for no others.',
  );
  return lines.join('\n');
}

/** The paragraph text with a ⟦n⟧ marker in front of each quote, numbered from `firstNumber`. */
function markParagraph(paragraph: string, spans: Array<{ start: number }>, firstNumber: number): string {
  if (spans.length === 0) return paragraph;
  let marked = '';
  let cursor = 0;
  spans.forEach((span, index) => {
    marked += paragraph.slice(cursor, span.start) + `⟦${firstNumber + index}⟧`;
    cursor = span.start;
  });
  return marked + paragraph.slice(cursor);
}

/** Group marked paragraphs into windows no bigger than WINDOW_CHARS. */
function windows(marked: string[]): string[] {
  const out: string[] = [];
  let current: string[] = [];
  let size = 0;
  for (const paragraph of marked) {
    if (current.length > 0 && size + paragraph.length > WINDOW_CHARS) {
      out.push(current.join('\n\n'));
      current = [];
      size = 0;
    }
    current.push(paragraph);
    size += paragraph.length + 2;
  }
  if (current.length > 0) out.push(current.join('\n\n'));
  return out;
}

/**
 * Work out who speaks each quote in one version of the text and who, if anyone,
 * narrates it, and store the answer. The text itself is never altered: the
 * attribution is a separate record the reader consults.
 */
export async function attributeVersion(options: AttributeOptions): Promise<AttributeOutcome> {
  const { db, ctx, projectId, versionId, signal, povCharacterId = null, force = false } = options;
  const none: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };

  const existing = readAttribution(db, versionId);
  if (existing && !force) return { attribution: existing, usage: none, skipped: true };
  if (ctx.characters.length === 0) return { attribution: null, usage: none, skipped: false };

  const version = readVersion(db, versionId);
  const paragraphs = splitParagraphs(version.content);
  const quotes: FoundQuote[] = [];
  const marked = paragraphs.map((paragraph, index) => {
    const spans = findQuotes(paragraph);
    const first = quotes.length;
    for (const span of spans) quotes.push({ paragraph: index, ...span });
    return markParagraph(paragraph, spans, first);
  });

  let texts = windows(marked);
  if (quotes.length === 0) texts = [marked.join('\n\n').slice(0, NARRATOR_SAMPLE_CHARS)];
  if (texts.every((text) => !text.trim())) return { attribution: null, usage: none, skipped: false };

  const validIds = new Set(ctx.characters.map((c) => c.id));
  const povName = povCharacterId ? (ctx.characters.find((c) => c.id === povCharacterId)?.name ?? null) : null;
  const system = buildAttributionSystemPrompt(ctx.characters, ctx.storyParameters, povName);

  const speakers = new Map<number, string>();
  let narratorId: string | null = null;
  let usage = none;

  for (const text of texts) {
    if (signal.aborted) return { attribution: null, usage, skipped: false };
    const result = await ctx.provider.generateStructured(
      {
        model: ctx.model,
        system,
        messages: [{ role: 'user', content: `<text>\n${text}\n</text>` }],
        schema: DialogueAttributionResult,
        schemaName: 'dialogue_attribution',
        effort: 'low',
        maxTokens: Math.min(16_000, 1_000 + quotes.length * 24),
      },
      signal,
    );
    usage = {
      inputTokens: usage.inputTokens + result.usage.inputTokens,
      outputTokens: usage.outputTokens + result.usage.outputTokens,
      cacheReadTokens: usage.cacheReadTokens + result.usage.cacheReadTokens,
    };
    if (!narratorId && validIds.has(result.data.narratorId.trim())) narratorId = result.data.narratorId.trim();
    for (const entry of result.data.speakers) {
      const id = entry.characterId.trim();
      if (Number.isInteger(entry.quote) && validIds.has(id)) speakers.set(entry.quote, id);
    }
  }

  const stored: DialogueQuote[] = quotes.map((quote, index) => ({ ...quote, speaker: speakers.get(index) ?? null }));
  const attribution = saveAttribution({ db, projectId, versionId, narratorId, quotes: stored, source: 'model' });
  return { attribution, usage, skipped: false };
}
