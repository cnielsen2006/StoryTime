import { useMemo, useState } from 'react';
import { kokoroAudio, kokoroVoiceLabel, readerAudio, sortKokoroVoices, unlockReaderAudio, useKokoro } from '../reading/kokoro.js';
import { Field } from './ui.js';

/**
 * Choose the Kokoro voice a character is read in, and hear it before deciding.
 * Leaving it empty means their lines are read in the narrator's voice.
 */
export function VoicePicker({
  value,
  onChange,
  name,
}: {
  value: string | null;
  onChange: (voice: string | null) => void;
  /** Used in the sample sentence. */
  name: string;
}) {
  const { data: info } = useKokoro(true);
  const voices = useMemo(() => sortKokoroVoices(info?.voices ?? []), [info]);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = async () => {
    if (!value) return;
    setError(null);
    setPreviewing(true);
    // Browsers only allow audio to start from a tap, and the sample arrives after a round trip.
    unlockReaderAudio();
    try {
      const url = await kokoroAudio(`Hello, I'm ${name}. This is how I sound when I speak.`, value);
      const audio = readerAudio();
      audio.src = url;
      audio.defaultPlaybackRate = 1;
      audio.playbackRate = 1;
      audio.onended = () => setPreviewing(false);
      await audio.play();
    } catch (err) {
      setPreviewing(false);
      setError(err instanceof Error ? err.message : 'Could not play the sample.');
    }
  };

  const loading = info?.status === 'loading' || (info && info.status === 'idle');

  return (
    <Field
      label="Reading voice"
      hint="Used when this book is read aloud. It says nothing about the story, so changing it never marks a chapter as out of date."
    >
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="field max-w-sm"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          aria-label={`Reading voice for ${name}`}
        >
          <option value="">Narrator&apos;s voice</option>
          {value && !voices.some((v) => v.id === value) ? <option value={value}>{value}</option> : null}
          {voices.map((voice) => (
            <option key={voice.id} value={voice.id}>
              {kokoroVoiceLabel(voice)}
            </option>
          ))}
        </select>
        <button type="button" className="btn-secondary text-xs" onClick={preview} disabled={!value || previewing}>
          {previewing ? 'Playing…' : '▶ Hear it'}
        </button>
        {loading ? <span className="text-xs text-ink-400">Loading the voice model…</span> : null}
      </div>
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
    </Field>
  );
}
