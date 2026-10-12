import { useEffect, useRef, useState } from 'react';
import { kokoroAudio, readerAudio, unlockReaderAudio } from './kokoro.js';
import { findVoice, speechSupported, useReadingSettings, useVoices } from './settings.js';
import type { SpeechSegment } from './text.js';

export type ReaderStatus = 'idle' | 'playing' | 'paused';

export interface Reader {
  supported: boolean;
  status: ReaderStatus;
  /** Waiting on the server for a Kokoro segment's audio. */
  buffering: boolean;
  /** The paragraph being read, or null when idle. */
  paragraph: number | null;
  error: string | null;
  play: () => void;
  pause: () => void;
  stop: () => void;
  nextParagraph: () => void;
  previousParagraph: () => void;
  readFromParagraph: (paragraph: number) => void;
}

/** speechSynthesis and the shared audio element are one per page, so only one reader may own them at a time. */
let releaseActive: (() => void) | null = null;

/** Segments to fetch ahead of the one playing, so Kokoro stays ahead of the listener. */
const KOKORO_PREFETCH = 2;

/**
 * Speaks segments one at a time, either with the browser's own voices or with
 * Kokoro audio from the server. Browser speech pauses by cancelling and later
 * restarting the current segment rather than using speechSynthesis.pause(),
 * which silently fails for online voices in Chrome and on Android. Kokoro audio
 * plays in an ordinary audio element, so it pauses and resumes mid-sentence.
 */
export function useReader(segments: SpeechSegment[], onFinished?: () => void): Reader {
  const [settings] = useReadingSettings();
  const voices = useVoices();
  const [status, setStatus] = useState<ReaderStatus>('idle');
  const [position, setPosition] = useState(0);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const kokoro = settings.engine === 'kokoro';

  // Every utterance or clip carries the token it was started with. Cancelling bumps
  // the token, so late onend/onerror events and slow fetches are ignored.
  const tokenRef = useRef(0);
  // Chrome can garbage-collect an utterance mid-speech and never fire onend.
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  // The segment whose Kokoro audio sits in the shared element, so Resume can carry on from it.
  const loadedRef = useRef<number | null>(null);
  const latest = useRef({ segments, settings, voices, onFinished, status, position });
  latest.current = { segments, settings, voices, onFinished, status, position };

  const releaseRef = useRef(() => {
    tokenRef.current += 1;
    loadedRef.current = null;
    setBuffering(false);
    setStatus('idle');
    setPosition(0);
  });
  const owns = () => releaseActive === releaseRef.current;

  const silence = () => {
    tokenRef.current += 1;
    utteranceRef.current = null;
    loadedRef.current = null;
    setBuffering(false);
    if (speechSupported) window.speechSynthesis.cancel();
    readerAudio().pause();
  };

  const speakFrom = (index: number) => {
    const { segments, settings } = latest.current;
    const useKokoro = settings.engine === 'kokoro';
    if (!useKokoro && !speechSupported) return;
    silence();
    if (releaseActive && !owns()) releaseActive();
    releaseActive = releaseRef.current;
    setError(null);

    const segment = segments[index];
    if (!segment) {
      setStatus('idle');
      setPosition(0);
      latest.current.onFinished?.();
      return;
    }

    setPosition(index);
    setStatus('playing');
    if (useKokoro) playKokoro(index, tokenRef.current);
    else speakBrowser(index, tokenRef.current);
  };

  const speakBrowser = (index: number, token: number) => {
    const { segments, settings, voices } = latest.current;
    const utterance = new SpeechSynthesisUtterance(segments[index]!.text);
    const voice = findVoice(voices, settings.voiceURI);
    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    }
    utterance.rate = settings.rate;
    utterance.pitch = settings.pitch;
    utterance.volume = settings.volume;
    utterance.onend = () => {
      if (tokenRef.current === token) speakFrom(index + 1);
    };
    utterance.onerror = (event) => {
      if (tokenRef.current !== token || event.error === 'interrupted' || event.error === 'canceled') return;
      setStatus('idle');
      setError(
        event.error === 'not-allowed'
          ? 'The browser blocked speech until you interact with the page. Press Listen to start.'
          : `The voice stopped with an error (${event.error}). Try another voice.`,
      );
    };

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  };

  const playKokoro = (index: number, token: number) => {
    const { segments, settings } = latest.current;
    const voice = settings.kokoroVoice;
    const current = kokoroAudio(segments[index]!.text, voice);
    // Requested after the current segment, so the server's queue works on what is needed first.
    for (let ahead = index + 1; ahead <= index + KOKORO_PREFETCH && ahead < segments.length; ahead++) {
      kokoroAudio(segments[ahead]!.text, voice).catch(() => undefined);
    }

    setBuffering(true);
    current.then(
      (url) => {
        if (tokenRef.current !== token) return;
        setBuffering(false);
        const { settings } = latest.current;
        const audio = readerAudio();
        audio.src = url;
        // Loading a new source resets playbackRate to the default rate.
        audio.defaultPlaybackRate = settings.rate;
        audio.playbackRate = settings.rate;
        audio.volume = settings.volume;
        audio.onended = () => {
          if (tokenRef.current === token) speakFrom(index + 1);
        };
        loadedRef.current = index;
        audio.play().catch((err: unknown) => {
          if (tokenRef.current !== token) return;
          setStatus('paused');
          setError(
            err instanceof DOMException && err.name === 'NotAllowedError'
              ? 'The browser blocked audio until you tap the page. Press Resume to carry on.'
              : `Could not play the audio (${err instanceof Error ? err.message : String(err)}).`,
          );
        });
      },
      (err: unknown) => {
        if (tokenRef.current !== token) return;
        setBuffering(false);
        setStatus('idle');
        const message = err instanceof Error ? err.message : String(err);
        setError(`${message} You can switch to browser voices in the reading settings.`);
      },
    );
  };

  const firstSegmentOf = (paragraph: number) => {
    const index = latest.current.segments.findIndex((s) => s.paragraph >= paragraph);
    return index === -1 ? latest.current.segments.length : index;
  };

  const jumpTo = (index: number) => {
    const { status, segments } = latest.current;
    const clamped = Math.max(0, Math.min(index, segments.length - 1));
    if (status === 'playing') speakFrom(clamped);
    else setPosition(clamped);
  };

  // A new voice takes effect straight away by restarting the current segment.
  useEffect(() => {
    const { status, position } = latest.current;
    if (status === 'playing') speakFrom(position);
    // Resuming must not carry on with audio in the old voice.
    else loadedRef.current = null;
  }, [settings.engine, settings.voiceURI, settings.kokoroVoice]);

  // Kokoro applies speed and volume to the audio already playing; browser speech has to restart.
  useEffect(() => {
    const { status, position, settings } = latest.current;
    if (settings.engine === 'kokoro') {
      if (!owns()) return;
      const audio = readerAudio();
      audio.defaultPlaybackRate = settings.rate;
      audio.playbackRate = settings.rate;
      audio.volume = settings.volume;
    } else if (status === 'playing') {
      speakFrom(position);
    }
  }, [settings.rate, settings.pitch, settings.volume]);

  // New text (another version, an edit) starts over.
  useEffect(() => {
    if (latest.current.status !== 'idle') {
      silence();
      setStatus('idle');
    }
    setPosition(0);
  }, [segments]);

  useEffect(
    () => () => {
      if (owns()) {
        releaseActive = null;
        silence();
      }
    },
    [],
  );

  const current = segments[position];

  return {
    supported: kokoro || speechSupported,
    status,
    buffering,
    paragraph: status === 'idle' || !current ? null : current.paragraph,
    error,
    play: () => {
      if (kokoro && status === 'paused' && loadedRef.current === position && owns()) {
        setError(null);
        setStatus('playing');
        readerAudio().play().catch(() => speakFrom(position));
        return;
      }
      if (kokoro) unlockReaderAudio();
      speakFrom(status === 'paused' ? position : 0);
    },
    pause: () => {
      if (kokoro && loadedRef.current === position && owns()) readerAudio().pause();
      else silence();
      setStatus('paused');
    },
    stop: () => {
      silence();
      if (owns()) releaseActive = null;
      setStatus('idle');
      setPosition(0);
    },
    nextParagraph: () => {
      const paragraph = segments[position]?.paragraph ?? 0;
      const next = firstSegmentOf(paragraph + 1);
      if (next >= segments.length) return;
      jumpTo(next);
    },
    previousParagraph: () => {
      const paragraph = segments[position]?.paragraph ?? 0;
      const start = firstSegmentOf(paragraph);
      // Like a music player: back once restarts the paragraph, twice goes to the one before.
      if (position > start) jumpTo(start);
      else jumpTo(firstSegmentOf(segments[start - 1]?.paragraph ?? 0));
    },
    readFromParagraph: (paragraph) => {
      if (kokoro) unlockReaderAudio();
      speakFrom(firstSegmentOf(paragraph));
    },
  };
}
