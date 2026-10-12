import { useQuery } from '@tanstack/react-query';
import { ApiError, get } from '../api/client.js';

/**
 * Kokoro voices are synthesized by the server, so they sound the same on every
 * device. Audio for a segment is fetched as a WAV and kept as an object URL so
 * going back a paragraph, or reading a chapter again, does not regenerate it.
 */

export interface KokoroVoice {
  id: string;
  name: string;
  language: string;
  gender: string;
  /** Kokoro's own quality grade, A (best) to F. */
  grade: string;
}

export interface KokoroInfo {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  voices: KokoroVoice[];
}

export const DEFAULT_KOKORO_VOICE = 'af_heart';

/** Fetching this also tells the server to start loading the model. */
export function useKokoro(enabled = true) {
  return useQuery({
    queryKey: ['speech'],
    queryFn: () => get<KokoroInfo>('/speech'),
    enabled,
    staleTime: 60_000,
    // Poll while the model downloads so the status line updates by itself.
    refetchInterval: (query) => (query.state.data?.status === 'loading' ? 2000 : false),
  });
}

/** Best voices first, then by accent and name. */
export function sortKokoroVoices(voices: KokoroVoice[]): KokoroVoice[] {
  return [...voices].sort(
    (a, b) => a.grade.localeCompare(b.grade) || a.language.localeCompare(b.language) || a.name.localeCompare(b.name),
  );
}

export function kokoroVoiceLabel(voice: KokoroVoice): string {
  const accent = voice.language === 'en-gb' ? 'British' : 'American';
  return `${voice.name} (${accent} ${voice.gender.toLowerCase()}, grade ${voice.grade})`;
}

const MAX_CACHED = 60;
const audioCache = new Map<string, Promise<string>>();

/** An object URL for the spoken text. Repeated and concurrent calls share one request. */
export function kokoroAudio(text: string, voice: string): Promise<string> {
  const key = `${voice}\n${text}`;
  const existing = audioCache.get(key);
  if (existing) {
    audioCache.delete(key);
    audioCache.set(key, existing);
    return existing;
  }

  const request = fetchAudio(text, voice);
  audioCache.set(key, request);
  // A failure should not stick: the next attempt might succeed once the model loads.
  request.catch(() => audioCache.delete(key));

  while (audioCache.size > MAX_CACHED) {
    const [oldKey, oldUrl] = audioCache.entries().next().value!;
    audioCache.delete(oldKey);
    oldUrl.then(URL.revokeObjectURL, () => undefined);
  }
  return request;
}

async function fetchAudio(text: string, voice: string): Promise<string> {
  const response = await fetch('/api/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text, voice }),
  });
  if (!response.ok) {
    let message = `The voice server answered with status ${response.status}.`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // Not JSON; keep the generic message.
    }
    throw new ApiError(response.status, message);
  }
  return URL.createObjectURL(await response.blob());
}

let sharedAudio: HTMLAudioElement | null = null;

/** One element for all reading, so the permission an iPhone grants it on a tap carries over. */
export function readerAudio(): HTMLAudioElement {
  sharedAudio ??= new Audio();
  return sharedAudio;
}

// A few milliseconds of silence, 8 kHz 8-bit mono.
const SILENCE = `data:audio/wav;base64,${btoa(
  'RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00@\x1f\x00\x00@\x1f\x00\x00\x01\x00\x08\x00data\x00\x00\x00\x00',
)}`;

/**
 * Safari and mobile browsers only let audio start from a tap. Audio for the
 * first segment arrives after a network round trip, by which time the tap no
 * longer counts, so play a moment of silence on the shared element during the
 * tap itself. Call this from click handlers before starting to read.
 */
export function unlockReaderAudio() {
  const audio = readerAudio();
  if (audio.src && !audio.paused) return;
  audio.src = SILENCE;
  audio.play().catch(() => undefined);
}
