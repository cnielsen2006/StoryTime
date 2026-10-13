import { describe, expect, it } from 'vitest';
import { buildSegments, speakableText, splitParagraphs, splitSentences } from './text.js';

describe('reading text', () => {
  it('splits on blank lines and keeps single line breaks inside a paragraph', () => {
    expect(splitParagraphs('One.\nStill one.\r\n\r\nTwo.\n\n\n  \nThree.')).toEqual([
      'One.\nStill one.',
      'Two.',
      'Three.',
    ]);
  });

  it('strips markdown and silences scene breaks', () => {
    expect(speakableText('## Chapter One')).toBe('Chapter One');
    expect(speakableText('She was *not* going **back**.')).toBe('She was not going back.');
    expect(speakableText('* * *')).toBe('');
    expect(speakableText('---')).toBe('');
  });

  it('keeps closing quotes with their sentence', () => {
    expect(splitSentences('"Go." She went! Did she? Yes')).toEqual(['"Go."', 'She went!', 'Did she?', 'Yes']);
  });

  it('groups sentences into short segments that remember their paragraph', () => {
    const long = Array.from({ length: 10 }, (_, i) => `This is sentence number ${i} of the paragraph.`).join(' ');
    const segments = buildSegments(['Short one.', '* * *', long]);

    expect(segments[0]).toEqual({ paragraph: 0, text: 'Short one.' });
    expect(segments.slice(1).every((s) => s.paragraph === 2)).toBe(true);
    expect(segments.length).toBeGreaterThan(2);
    expect(segments.every((s) => s.text.length <= 220)).toBe(true);
    expect(segments.slice(1).map((s) => s.text).join(' ')).toBe(long);
  });
});

describe('reading text with attributed dialogue', () => {
  const paragraph = '"Get down," she said. "Now."';
  const quotes = [
    { paragraph: 0, start: 0, end: 11, speaker: 'mara' },
    { paragraph: 0, start: 22, end: 28, speaker: null },
  ];

  it('splits a paragraph at its quotes so each speaker gets their own segment', () => {
    expect(buildSegments([paragraph], quotes)).toEqual([
      { paragraph: 0, text: '"Get down,"', dialogue: true, speaker: 'mara' },
      { paragraph: 0, text: 'she said.', dialogue: false },
      { paragraph: 0, text: '"Now."', dialogue: true, speaker: null },
    ]);
  });

  it('marks paragraphs without dialogue as narration once attribution exists', () => {
    expect(buildSegments(['Rain fell.', paragraph], quotes.map((q) => ({ ...q, paragraph: 1 })))[0]).toEqual({
      paragraph: 0,
      text: 'Rain fell.',
      dialogue: false,
    });
  });

  it('ignores stored quotes that no longer fit the paragraph', () => {
    const stale = [{ paragraph: 0, start: 0, end: 500, speaker: 'mara' }];
    expect(buildSegments([paragraph], stale)).toEqual([{ paragraph: 0, text: '"Get down," she said. "Now."', dialogue: false }]);
  });

  it('leaves segments plain when nothing is attributed', () => {
    expect(buildSegments([paragraph])).toEqual([{ paragraph: 0, text: '"Get down," she said. "Now."' }]);
  });
});
