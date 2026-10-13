import type { SpeechSegment } from './text.js';

/** Who reads what: the voice each character was given, and which character, if any, tells the story. */
export interface VoiceCast {
  /** The narrator's voice, used for everything that is not a character's own line. */
  fallback: string;
  /** The character telling the story in first person. Null when the narration is third person. */
  narratorId: string | null;
  /** Character id to Kokoro voice id. */
  voices: ReadonlyMap<string, string>;
  /** Voices the server offers. Null until the list has loaded, when none can be ruled out. */
  available: ReadonlySet<string> | null;
}

/**
 * Pick the voice for one segment. A character's lines use their voice, narration
 * uses the first-person narrator's voice if there is one, and anything that has
 * no voice to use, such as an unnamed speaker or a voice the server no longer
 * has, falls back to the narrator's own.
 */
export function voiceForSegment(segment: SpeechSegment, cast: VoiceCast): string {
  const speaker = segment.dialogue ? (segment.speaker ?? null) : cast.narratorId;
  const voice = speaker ? cast.voices.get(speaker) : undefined;
  if (!voice) return cast.fallback;
  if (cast.available && !cast.available.has(voice)) return cast.fallback;
  return voice;
}
