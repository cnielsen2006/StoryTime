import type { CharacterDetail } from '@storytime/shared';
import type { SpeechVoice } from './kokoro.js';

/**
 * Suggests a distinct Kokoro voice for each character. The model is not asked:
 * pronouns in a character's own notes say what the author imagined, voices are
 * handed out best-first, and the accents alternate so neighbours in a scene do
 * not sound alike. It is only a starting point the author can change.
 */

type Gender = 'female' | 'male';

const FEMALE = /\b(she|her|hers|herself)\b/gi;
const MALE = /\b(he|him|his|himself)\b/gi;

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

/** The gender the author's own notes lean towards, or null when they do not say. */
export function guessGender(character: CharacterDetail): Gender | null {
  const text = [
    character.description,
    character.appearance,
    character.personality,
    character.backstory,
    character.arcNotes,
    ...character.experiences.flatMap((e) => [e.description, e.impact]),
  ]
    .filter(Boolean)
    .join(' ');
  const female = count(text, FEMALE);
  const male = count(text, MALE);
  if (female === male) return null;
  return female > male ? 'female' : 'male';
}

const ROLE_ORDER: Record<string, number> = { protagonist: 0, antagonist: 1, supporting: 2, minor: 3 };

/** Voices of one gender, best quality first, alternating American and British. */
function poolFor(voices: SpeechVoice[], gender: Gender, taken: Set<string>): SpeechVoice[] {
  const ofGender = voices
    .filter((v) => v.gender.toLowerCase() === gender && !taken.has(v.id))
    .sort((a, b) => a.grade.localeCompare(b.grade) || a.name.localeCompare(b.name));
  const us = ofGender.filter((v) => v.language !== 'en-gb');
  const gb = ofGender.filter((v) => v.language === 'en-gb');
  const mixed: SpeechVoice[] = [];
  for (let i = 0; i < Math.max(us.length, gb.length); i += 1) {
    if (us[i]) mixed.push(us[i]!);
    if (gb[i]) mixed.push(gb[i]!);
  }
  return mixed;
}

export interface CastingOptions {
  /** Voices that must not be handed out, such as the one used for narration. */
  exclude?: string[];
  /** Replace voices characters already have. Otherwise those are kept and avoided. */
  overwrite?: boolean;
}

/** Character id to voice id, for the characters that should change. */
export function suggestVoices(
  characters: CharacterDetail[],
  voices: SpeechVoice[],
  options: CastingOptions = {},
): Map<string, string> {
  const { exclude = [], overwrite = false } = options;
  const keep = overwrite ? [] : characters.filter((c) => c.voice);
  const taken = new Set([...exclude, ...keep.map((c) => c.voice!)]);
  const pools: Record<Gender, SpeechVoice[]> = {
    female: poolFor(voices, 'female', taken),
    male: poolFor(voices, 'male', taken),
  };
  const used: Record<Gender, number> = { female: 0, male: 0 };

  const todo = characters
    .filter((c) => overwrite || !c.voice)
    .sort((a, b) => (ROLE_ORDER[a.role] ?? 4) - (ROLE_ORDER[b.role] ?? 4) || a.sortOrder - b.sortOrder);

  const result = new Map<string, string>();
  for (const character of todo) {
    // Without a lean either way, balance the cast by drawing from whichever side has fewer.
    const gender = guessGender(character) ?? (used.female <= used.male ? 'female' : 'male');
    const pool = pools[gender].length > 0 ? pools[gender] : pools[gender === 'female' ? 'male' : 'female'];
    if (pool.length === 0) break;
    // A cast bigger than the pool starts reusing voices rather than leaving anyone silent.
    result.set(character.id, pool[used[gender] % pool.length]!.id);
    used[gender] += 1;
  }
  return result;
}
