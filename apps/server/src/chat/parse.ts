/**
 * The revision assistant answers in plain text: a conversational reply, plus
 * the full revised text of any section it changed inside
 * <revised_section id="..."> tags. That keeps the reply streamable and avoids
 * asking a model to escape thousands of words of prose into JSON.
 */

export const SECTION_OPEN = '<revised_section';
export const SECTION_CLOSE = '</revised_section>';

/** An opening tag that never reaches its ">" within this many characters is just text. */
const MAX_TAG_LENGTH = 300;

export interface RevisedSection {
  /** The id of the manuscript section being replaced, or null if the model left it out. */
  id: string | null;
  text: string;
  /** False when the stream ended before the closing tag, so the text is cut off. */
  complete: boolean;
}

/** How many trailing characters of `text` could be the start of `tag`, and so must wait for more input. */
function heldBack(text: string, tag: string): number {
  for (let length = Math.min(tag.length - 1, text.length); length > 0; length -= 1) {
    if (tag.startsWith(text.slice(text.length - length))) return length;
  }
  return 0;
}

/** Models like to wrap long text in a code fence; the fence is not part of the prose. */
function unfence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```[a-z]*\n([\s\S]*?)\n?```$/.exec(trimmed);
  return fenced ? fenced[1]!.trim() : trimmed;
}

/**
 * Splits a streamed answer into the conversation the author reads and the
 * revised sections to apply. Feed it deltas as they arrive; it never rescans
 * what it has already seen, so a long chapter costs the same per delta as a
 * short one, and a tag split across two deltas is recognised once whole.
 */
export class ReplyParser {
  private visible = '';
  private buffer = '';
  private current: RevisedSection | null = null;
  readonly sections: RevisedSection[] = [];

  /** Everything said outside revised sections so far, as the author sees it. */
  get reply(): string {
    return this.visible;
  }

  /** Take the next piece of the stream. Returns the newly visible reply text and any section that just began. */
  push(delta: string): { reply: string; opened: RevisedSection | null } {
    this.buffer += delta;
    let reply = '';
    let opened: RevisedSection | null = null;

    for (;;) {
      if (this.current) {
        const close = this.buffer.indexOf(SECTION_CLOSE);
        if (close !== -1) {
          this.current.text += this.buffer.slice(0, close);
          this.current.complete = true;
          this.current = null;
          this.buffer = this.buffer.slice(close + SECTION_CLOSE.length);
          continue;
        }
        const keep = heldBack(this.buffer, SECTION_CLOSE);
        this.current.text += this.buffer.slice(0, this.buffer.length - keep);
        this.buffer = this.buffer.slice(this.buffer.length - keep);
        break;
      }

      const open = this.buffer.indexOf(SECTION_OPEN);
      if (open === -1) {
        const keep = heldBack(this.buffer, SECTION_OPEN);
        reply += this.buffer.slice(0, this.buffer.length - keep);
        this.buffer = this.buffer.slice(this.buffer.length - keep);
        break;
      }

      reply += this.buffer.slice(0, open);
      const rest = this.buffer.slice(open);
      const next = rest[SECTION_OPEN.length];
      if (next !== undefined && !/[\s>]/.test(next)) {
        // "<revised_sectional": not our tag.
        reply += rest.slice(0, SECTION_OPEN.length);
        this.buffer = rest.slice(SECTION_OPEN.length);
        continue;
      }
      const end = rest.indexOf('>');
      if (end === -1) {
        if (rest.length > MAX_TAG_LENGTH) {
          reply += rest[0];
          this.buffer = rest.slice(1);
          continue;
        }
        // The tag is still arriving.
        this.buffer = rest;
        break;
      }

      const id = /\bid\s*=\s*["']?([^"'>\s]*)/.exec(rest.slice(0, end))?.[1]?.trim();
      const section: RevisedSection = { id: id || null, text: '', complete: false };
      this.sections.push(section);
      this.current = section;
      opened = section;
      this.buffer = rest.slice(end + 1);
    }

    this.visible += reply;
    return { reply, opened };
  }

  /** The stream is over: whatever was held back is now just text, and an open section stays incomplete. */
  end() {
    if (this.current) this.current.text += this.buffer;
    else this.visible += this.buffer;
    this.buffer = '';
  }

  /** The conversational part, tidied for storing. */
  finalReply(): string {
    return this.visible.replace(/\n{3,}/g, '\n\n').trim();
  }

  /** Sections with their text tidied, ready to apply. */
  finalSections(): RevisedSection[] {
    return this.sections.map((section) => ({ ...section, text: unfence(section.text) }));
  }
}

/** Parse a whole answer at once. */
export function parseReply(raw: string): { reply: string; sections: RevisedSection[] } {
  const parser = new ReplyParser();
  parser.push(raw);
  parser.end();
  return { reply: parser.finalReply(), sections: parser.finalSections() };
}
