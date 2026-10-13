import { describe, expect, it } from 'vitest';
import { voiceForSegment, type VoiceCast } from './voices.js';

const cast = (over: Partial<VoiceCast> = {}): VoiceCast => ({
  fallback: 'af_heart',
  narratorId: null,
  voices: new Map([
    ['mara', 'bf_emma'],
    ['edvin', 'am_michael'],
  ]),
  available: null,
  ...over,
});

describe('voiceForSegment', () => {
  it("reads a character's lines in their voice", () => {
    expect(voiceForSegment({ paragraph: 0, text: 'Go.', dialogue: true, speaker: 'edvin' }, cast())).toBe('am_michael');
  });

  it("reads narration in the narrator's voice, or the first-person narrator's when there is one", () => {
    const narration = { paragraph: 0, text: 'He went.', dialogue: false };
    expect(voiceForSegment(narration, cast())).toBe('af_heart');
    expect(voiceForSegment(narration, cast({ narratorId: 'mara' }))).toBe('bf_emma');
  });

  it("gives an unnamed speaker the narrator's voice, not the first-person narrator's", () => {
    const stranger = { paragraph: 0, text: 'Who goes?', dialogue: true, speaker: null };
    expect(voiceForSegment(stranger, cast({ narratorId: 'mara' }))).toBe('af_heart');
  });

  it('falls back when a character has no voice or the server no longer offers theirs', () => {
    expect(voiceForSegment({ paragraph: 0, text: 'Hm.', dialogue: true, speaker: 'nobody' }, cast())).toBe('af_heart');
    const limited = cast({ available: new Set(['af_heart']) });
    expect(voiceForSegment({ paragraph: 0, text: 'Go.', dialogue: true, speaker: 'edvin' }, limited)).toBe('af_heart');
  });

  it("reads plain, unattributed text in the first-person narrator's voice when there is one", () => {
    expect(voiceForSegment({ paragraph: 0, text: 'Plain.' }, cast({ narratorId: 'mara' }))).toBe('bf_emma');
  });
});
