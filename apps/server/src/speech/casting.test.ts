import { describe, expect, it } from 'vitest';
import type { CharacterDetail } from '@storytime/shared';
import { guessGender, suggestVoices } from './casting.js';
import type { SpeechVoice } from './kokoro.js';

const voice = (id: string, gender: string, language: string, grade: string): SpeechVoice => ({
  id,
  name: id.slice(3),
  language,
  gender,
  grade,
});

const VOICES = [
  voice('af_heart', 'Female', 'en-us', 'A'),
  voice('af_bella', 'Female', 'en-us', 'A-'),
  voice('bf_emma', 'Female', 'en-gb', 'B-'),
  voice('am_michael', 'Male', 'en-us', 'C+'),
  voice('am_fenrir', 'Male', 'en-us', 'C+'),
  voice('bm_george', 'Male', 'en-gb', 'C'),
];

let counter = 0;
function character(over: Partial<CharacterDetail>): CharacterDetail {
  counter += 1;
  return {
    id: `c${counter}`,
    projectId: 'p',
    name: `Person ${counter}`,
    role: 'supporting',
    description: null,
    appearance: null,
    personality: null,
    backstory: null,
    arcNotes: null,
    voice: null,
    sortOrder: counter,
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    experiences: [],
    ...over,
  };
}

describe('guessGender', () => {
  it('goes by the pronouns in the author\'s own notes', () => {
    expect(guessGender(character({ description: 'She keeps the lamps. Her hands are scarred.' }))).toBe('female');
    expect(guessGender(character({ backstory: 'He left home. His mother never forgave him.' }))).toBe('male');
  });

  it('says nothing when the notes do not lean either way', () => {
    expect(guessGender(character({}))).toBeNull();
    expect(guessGender(character({ description: 'She and he argued.' }))).toBeNull();
  });
});

describe('suggestVoices', () => {
  it('gives each character a distinct voice of the right gender, best first', () => {
    const cast = [
      character({ role: 'protagonist', description: 'She runs the archive.' }),
      character({ description: 'He hates the archive.' }),
      character({ description: 'She is the warden. Her voice is calm.' }),
    ];
    const chosen = suggestVoices(cast, VOICES);
    expect(chosen.get(cast[0]!.id)).toBe('af_heart');
    expect(chosen.get(cast[1]!.id)).toBe('am_fenrir');
    // The second woman gets an accent that differs from the first.
    expect(chosen.get(cast[2]!.id)).toBe('bf_emma');
    expect(new Set(chosen.values()).size).toBe(3);
  });

  it('keeps voices the author chose and does not hand them out again', () => {
    const chosen = suggestVoices(
      [character({ voice: 'af_heart', description: 'She.' }), character({ description: 'She sings.' })],
      VOICES,
    );
    expect([...chosen.values()]).toEqual(['af_bella']);
  });

  it('can replace what is there', () => {
    const cast = [character({ voice: 'bm_george', description: 'She.' })];
    expect(suggestVoices(cast, VOICES, { overwrite: true }).get(cast[0]!.id)).toBe('af_heart');
  });

  it('keeps the narrator\'s voice free', () => {
    const cast = [character({ description: 'She.' })];
    expect(suggestVoices(cast, VOICES, { exclude: ['af_heart'] }).get(cast[0]!.id)).toBe('af_bella');
  });

  it('reuses voices rather than leaving a big cast silent', () => {
    const cast = Array.from({ length: 6 }, () => character({ description: 'She.' }));
    const chosen = suggestVoices(cast, VOICES);
    expect(chosen.size).toBe(6);
  });

  it('balances a cast the notes do not describe', () => {
    const cast = [character({ role: 'protagonist' }), character({}), character({})];
    const genders = [...suggestVoices(cast, VOICES).values()].map((id) => VOICES.find((v) => v.id === id)!.gender);
    expect(genders.filter((g) => g === 'Female')).toHaveLength(2);
    expect(genders.filter((g) => g === 'Male')).toHaveLength(1);
  });
});
