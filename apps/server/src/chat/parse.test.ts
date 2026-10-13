import { describe, expect, it } from 'vitest';
import { ReplyParser, parseReply } from './parse.js';

const ANSWER = [
  'I tightened the opening and cut the flashback.',
  '',
  '<revised_section id="ab12">',
  'The door closed.',
  '',
  'She did not look back.',
  '</revised_section>',
  '',
  'Want me to do the same to the ending?',
].join('\n');

describe('ReplyParser', () => {
  it('separates the conversation from the revised text', () => {
    const { reply, sections } = parseReply(ANSWER);
    expect(reply).toBe('I tightened the opening and cut the flashback.\n\nWant me to do the same to the ending?');
    expect(sections).toEqual([{ id: 'ab12', text: 'The door closed.\n\nShe did not look back.', complete: true }]);
  });

  it('gives the same answer however the stream is chopped up', () => {
    const whole = parseReply(ANSWER);
    for (const size of [1, 2, 3, 5, 7, 16, 40, ANSWER.length]) {
      const parser = new ReplyParser();
      let streamed = '';
      for (let i = 0; i < ANSWER.length; i += size) streamed += parser.push(ANSWER.slice(i, i + size)).reply;
      parser.end();
      expect({ size, reply: parser.finalReply(), sections: parser.finalSections() }).toEqual({
        size,
        ...whole,
      });
      // What the author watched arrive is the conversation, never a half-written tag or the revised text.
      expect(streamed + (parser.reply.slice(streamed.length))).toBe(parser.reply);
      expect(streamed).not.toContain('<revised');
      expect(streamed).not.toContain('The door closed');
    }
  });

  it('never shows a tag that is still arriving', () => {
    const parser = new ReplyParser();
    expect(parser.push('Done. <revised_sec').reply).toBe('Done. ');
    expect(parser.push('tion id="x').reply).toBe('');
    expect(parser.push('">New text</revised_sec').reply).toBe('');
    expect(parser.push('tion> Bye.').reply).toBe(' Bye.');
  });

  it('keeps text that merely looks like the start of a tag', () => {
    const parser = new ReplyParser();
    parser.push('Use the <rev');
    parser.push('ision> button, or <revised_sectional> text.');
    parser.end();
    expect(parser.finalReply()).toBe('Use the <revision> button, or <revised_sectional> text.');
    expect(parser.sections).toHaveLength(0);
  });

  it('marks a section cut off before its closing tag as incomplete', () => {
    const { sections } = parseReply('Here.\n<revised_section id="ab12">The door cl');
    expect(sections).toEqual([{ id: 'ab12', text: 'The door cl', complete: false }]);
  });

  it('handles several sections and a missing id', () => {
    const { sections } = parseReply('<revised_section id="a">One</revised_section><revised_section>Two</revised_section>');
    expect(sections.map((s) => [s.id, s.text, s.complete])).toEqual([
      ['a', 'One', true],
      [null, 'Two', true],
    ]);
  });

  it('removes a code fence the model wrapped around the text', () => {
    const { sections } = parseReply('<revised_section id="a">\n```\nProse here.\n```\n</revised_section>');
    expect(sections[0]!.text).toBe('Prose here.');
  });

  it('reports a section the moment it opens', () => {
    const parser = new ReplyParser();
    expect(parser.push('Sure. ').opened).toBeNull();
    expect(parser.push('<revised_section id="q">hi').opened?.id).toBe('q');
  });
});
