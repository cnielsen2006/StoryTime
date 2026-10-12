import { useEffect, useState, useSyncExternalStore } from 'react';
import { DEFAULT_KOKORO_VOICE } from './kokoro.js';

/**
 * Reading voice preferences. These live in the browser rather than on the
 * server because browser voices come from the device: a voice picked on a
 * laptop may not exist on a phone opening the same book over the LAN.
 */
export type ReadingEngine = 'kokoro' | 'browser';

export interface ReadingSettings {
  /** Kokoro voices come from the StoryTime server; browser voices from this device. */
  engine: ReadingEngine;
  /** Kokoro voice id such as af_heart. */
  kokoroVoice: string;
  /** SpeechSynthesisVoice.voiceURI, or empty for the browser's default voice. */
  voiceURI: string;
  rate: number;
  /** Browser voices only: Kokoro has no pitch control. */
  pitch: number;
  volume: number;
  highlight: boolean;
  autoScroll: boolean;
  /** Move on to the next chapter when one finishes. */
  continueToNext: boolean;
}

export const DEFAULT_READING_SETTINGS: ReadingSettings = {
  engine: 'kokoro',
  kokoroVoice: DEFAULT_KOKORO_VOICE,
  voiceURI: '',
  rate: 1,
  pitch: 1,
  volume: 1,
  highlight: true,
  autoScroll: true,
  continueToNext: true,
};

export const SPEED_OPTIONS = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];

const STORAGE_KEY = 'storytime.reading';

function load(): ReadingSettings {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...DEFAULT_READING_SETTINGS, ...(JSON.parse(stored) as Partial<ReadingSettings>) };
  } catch {
    // Unreadable storage falls back to defaults.
  }
  return DEFAULT_READING_SETTINGS;
}

let current = load();
const listeners = new Set<() => void>();

export function getReadingSettings(): ReadingSettings {
  return current;
}

export function updateReadingSettings(patch: Partial<ReadingSettings>) {
  current = { ...current, ...patch };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Private browsing and full quotas are not worth failing over.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Shared across every component, so a change in Settings reaches a chapter being read. */
export function useReadingSettings(): [ReadingSettings, (patch: Partial<ReadingSettings>) => void] {
  return [useSyncExternalStore(subscribe, getReadingSettings), updateReadingSettings];
}

export const speechSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

/** The device's voices. Most browsers load them asynchronously, so the first call is often empty. */
export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() =>
    speechSupported ? window.speechSynthesis.getVoices() : [],
  );

  useEffect(() => {
    if (!speechSupported) return;
    const refresh = () => setVoices(window.speechSynthesis.getVoices());
    refresh();
    window.speechSynthesis.addEventListener('voiceschanged', refresh);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', refresh);
  }, []);

  return voices;
}

export function findVoice(voices: SpeechSynthesisVoice[], voiceURI: string): SpeechSynthesisVoice | undefined {
  return voiceURI ? voices.find((v) => v.voiceURI === voiceURI) : undefined;
}

/** Voices sorted with the reader's own language first, then by language and name. */
export function sortVoices(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice[] {
  const preferred = (navigator.language || 'en').split('-')[0]!.toLowerCase();
  const rank = (v: SpeechSynthesisVoice) => (v.lang.toLowerCase().startsWith(preferred) ? 0 : 1);
  return [...voices].sort(
    (a, b) => rank(a) - rank(b) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name),
  );
}

export function voiceLabel(voice: SpeechSynthesisVoice): string {
  const tags = [voice.lang, voice.localService ? null : 'online'].filter(Boolean).join(', ');
  return `${voice.name} (${tags})`;
}

export function formatSpeed(rate: number): string {
  return `${rate.toFixed(2).replace(/\.?0+$/, '')}×`;
}
