/**
 * Turns manuscript text into paragraphs for display and short segments for
 * speech. Browsers cut long utterances off partway (Chrome stops after about
 * fifteen seconds with some voices), so each paragraph is spoken a few
 * sentences at a time.
 */

import { splitAtQuotes, splitParagraphs, type DialogueQuote } from '@storytime/shared';

// The server finds quotes in paragraphs cut by this same function, so it lives in the shared package.
export { splitParagraphs };

export interface SpeechSegment {
  /** Index into the paragraph list, used for highlighting. */
  paragraph: number;
  text: string;
  /** Only when dialogue has been attributed: true for a quoted line, false for narration. */
  dialogue?: boolean;
  /** The character speaking a quoted line, or null when nobody on the cast is. */
  speaker?: string | null;
}

const MAX_SEGMENT_CHARS = 220;

/** What a paragraph sounds like once markdown and scene breaks are removed. */
export function speakableText(paragraph: string): string {
  const text = paragraph
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
  // A paragraph of only punctuation is a scene break like "* * *" or "---".
  return /[\p{L}\p{N}]/u.test(text) ? text : '';
}

export function splitSentences(text: string): string[] {
  const sentences = text.match(/[^.!?…]+(?:[.!?…]+["'”’)\]]*|$)\s*/g) ?? [text];
  return sentences.map((s) => s.trim()).filter(Boolean);
}

/** Short segments of one piece of text, never longer than MAX_SEGMENT_CHARS unless a sentence is. */
function chunk(text: string, paragraph: number, extra: Partial<SpeechSegment>): SpeechSegment[] {
  const segments: SpeechSegment[] = [];
  let current = '';
  for (const sentence of splitSentences(text)) {
    if (current && current.length + sentence.length + 1 > MAX_SEGMENT_CHARS) {
      segments.push({ paragraph, text: current, ...extra });
      current = '';
    }
    current = current ? `${current} ${sentence}` : sentence;
  }
  if (current) segments.push({ paragraph, text: current, ...extra });
  return segments;
}

/** The quotes stored for one paragraph, if they still make sense for its text. */
function quotesFor(paragraph: string, index: number, quotes: DialogueQuote[]): DialogueQuote[] {
  const mine = quotes.filter((q) => q.paragraph === index).sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const quote of mine) {
    if (quote.start < cursor || quote.end <= quote.start || quote.end > paragraph.length) return [];
    cursor = quote.end;
  }
  return mine;
}

/**
 * Cut paragraphs into short pieces to speak. With dialogue attributed, each
 * paragraph is first split at its quotes so a character's lines can be read in
 * their own voice and everything between them in the narrator's.
 */
export function buildSegments(paragraphs: string[], quotes?: DialogueQuote[]): SpeechSegment[] {
  const segments: SpeechSegment[] = [];
  paragraphs.forEach((paragraph, index) => {
    const found = quotes ? quotesFor(paragraph, index, quotes) : [];
    if (found.length === 0) {
      const text = speakableText(paragraph);
      if (text) segments.push(...chunk(text, index, quotes ? { dialogue: false } : {}));
      return;
    }

    for (const piece of splitAtQuotes(paragraph, found)) {
      const text = speakableText(piece.text);
      if (!text) continue;
      const quote = piece.quote === null ? null : found[piece.quote]!;
      segments.push(...chunk(text, index, quote ? { dialogue: true, speaker: quote.speaker } : { dialogue: false }));
    }
  });
  return segments;
}
