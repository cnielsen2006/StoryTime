/**
 * Manuscript text helpers shared by the server, which finds and attributes
 * dialogue, and the reader in the browser, which has to split paragraphs exactly
 * the same way for the stored positions to line up.
 */

/** Blank-line separated paragraphs, with surrounding whitespace trimmed and empty ones dropped. */
export function splitParagraphs(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n(?:[ \t]*\n)+/)
    .map((p) => p.replace(/^\n+|\s+$/g, ''))
    .filter((p) => p.trim().length > 0);
}

/** A quoted passage inside one paragraph. `end` is exclusive and both quote marks are included. */
export interface QuoteSpan {
  start: number;
  end: number;
}

const CLOSERS: Record<string, string> = { '“': '”', '‘': '’', '«': '»' };

const isLetter = (char: string | undefined) => char !== undefined && /\p{L}/u.test(char);
const isSpaceOrNone = (char: string | undefined) => char === undefined || /\s/.test(char);

/** Can a quote open here? Mid-word quotes are apostrophes or inch marks, not speech. */
function canOpen(text: string, index: number): boolean {
  const before = text[index - 1];
  return isSpaceOrNone(before) || /[([{\-–—…]/.test(before ?? '');
}

/**
 * Find quoted speech in a paragraph. Handles straight and curly double quotes
 * and curly single quotes; straight single quotes are too ambiguous with
 * apostrophes to trust. A quote still open at the end of the paragraph runs to
 * the end, which is how multi-paragraph speech is written: each paragraph opens
 * a quote and only the last closes it.
 */
export function findQuotes(paragraph: string): QuoteSpan[] {
  const spans: QuoteSpan[] = [];
  let open: { start: number; closer: string } | null = null;

  const finish = (start: number, end: number) => {
    // Punctuation-only quotes are scare quotes or typography, not something to voice.
    if (/[\p{L}\p{N}]/u.test(paragraph.slice(start, end))) spans.push({ start, end });
  };

  for (let i = 0; i < paragraph.length; i += 1) {
    const char = paragraph[i]!;

    if (open) {
      if (char !== open.closer) continue;
      // A closing single quote followed by a letter is an apostrophe: "don't", "'em".
      if (char === '’' && isLetter(paragraph[i + 1])) continue;
      finish(open.start, i + 1);
      open = null;
      continue;
    }

    if (char === '"') {
      if (canOpen(paragraph, i)) open = { start: i, closer: '"' };
    } else if (char in CLOSERS) {
      if (char === '“' || char === '«' || canOpen(paragraph, i)) open = { start: i, closer: CLOSERS[char]! };
    }
  }

  if (open) finish(open.start, paragraph.length);
  return spans;
}

export interface TextPiece {
  text: string;
  /** Index into the quote list this piece came from, or null for narration. */
  quote: number | null;
}

/** Cut a paragraph into narration and quoted pieces, in order, given its quote spans. */
export function splitAtQuotes(paragraph: string, spans: QuoteSpan[]): TextPiece[] {
  const pieces: TextPiece[] = [];
  let cursor = 0;
  spans.forEach((span, index) => {
    if (span.start > cursor) pieces.push({ text: paragraph.slice(cursor, span.start), quote: null });
    pieces.push({ text: paragraph.slice(span.start, span.end), quote: index });
    cursor = span.end;
  });
  if (cursor < paragraph.length) pieces.push({ text: paragraph.slice(cursor), quote: null });
  return pieces;
}
