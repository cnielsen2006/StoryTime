/**
 * Turns manuscript text into paragraphs for display and short segments for
 * speech. Browsers cut long utterances off partway (Chrome stops after about
 * fifteen seconds with some voices), so each paragraph is spoken a few
 * sentences at a time.
 */

export interface SpeechSegment {
  /** Index into the paragraph list, used for highlighting. */
  paragraph: number;
  text: string;
}

const MAX_SEGMENT_CHARS = 220;

export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n(?:[ \t]*\n)+/)
    .map((p) => p.replace(/^\n+|\s+$/g, ''))
    .filter((p) => p.trim().length > 0);
}

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

export function buildSegments(paragraphs: string[]): SpeechSegment[] {
  const segments: SpeechSegment[] = [];
  paragraphs.forEach((paragraph, index) => {
    const text = speakableText(paragraph);
    if (!text) return;

    let current = '';
    for (const sentence of splitSentences(text)) {
      if (current && current.length + sentence.length + 1 > MAX_SEGMENT_CHARS) {
        segments.push({ paragraph: index, text: current });
        current = '';
      }
      current = current ? `${current} ${sentence}` : sentence;
    }
    if (current) segments.push({ paragraph: index, text: current });
  });
  return segments;
}
