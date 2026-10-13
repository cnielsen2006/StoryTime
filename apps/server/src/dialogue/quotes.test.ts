import { describe, expect, it } from 'vitest';
import { findQuotes, splitAtQuotes, splitParagraphs } from '@storytime/shared';

const quoted = (text: string) => findQuotes(text).map((span) => text.slice(span.start, span.end));

describe('findQuotes', () => {
  it('finds straight and curly double quotes', () => {
    expect(quoted('"Get down," she said. "Now."')).toEqual(['"Get down,"', '"Now."']);
    expect(quoted('“Get down,” she said. “Now.”')).toEqual(['“Get down,”', '“Now.”']);
  });

  it('finds curly single quotes but leaves apostrophes alone', () => {
    expect(quoted('‘Get down,’ she said.')).toEqual(['‘Get down,’']);
    expect(quoted('It’s the dogs’ bowls and ’em things, isn’t it?')).toEqual([]);
    expect(quoted("She said it's fine and he'd agree.")).toEqual([]);
  });

  it('does not close a single-quoted passage on an apostrophe inside it', () => {
    expect(quoted('‘I don’t know,’ he said.')).toEqual(['‘I don’t know,’']);
  });

  it('ignores a nested quote of a different kind', () => {
    expect(quoted('“She told me ‘run’ and I did,” he said.')).toEqual(['“She told me ‘run’ and I did,”']);
  });

  it('lets a quote that is still open run to the end of the paragraph', () => {
    expect(quoted('"First paragraph of a long speech, which goes on')).toEqual([
      '"First paragraph of a long speech, which goes on',
    ]);
  });

  it('skips quotes with nothing speakable in them', () => {
    expect(quoted('He wrote "" on the wall and then "—" again.')).toEqual([]);
    expect(quoted('The sign said "7".')).toEqual(['"7"']);
  });

  it('does not treat a mid-word straight quote as the start of speech', () => {
    expect(quoted('He was 6\'2" tall and said "hello".')).toEqual(['"hello"']);
  });

  it('reports spans that cut the paragraph into narration and quotes', () => {
    const paragraph = '"Go," she said, and went. "Wait!"';
    const pieces = splitAtQuotes(paragraph, findQuotes(paragraph));
    expect(pieces).toEqual([
      { text: '"Go,"', quote: 0 },
      { text: ' she said, and went. ', quote: null },
      { text: '"Wait!"', quote: 1 },
    ]);
    expect(pieces.map((p) => p.text).join('')).toBe(paragraph);
  });
});

describe('splitParagraphs', () => {
  it('splits on blank lines and keeps single line breaks inside a paragraph', () => {
    expect(splitParagraphs('One.\nStill one.\r\n\r\nTwo.\n\n\n  \nThree.')).toEqual([
      'One.\nStill one.',
      'Two.',
      'Three.',
    ]);
  });
});
