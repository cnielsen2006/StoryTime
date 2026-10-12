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
