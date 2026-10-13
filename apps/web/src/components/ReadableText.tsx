import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useProjectGraph } from '../api/hooks.js';
import { useAssignVoices, useDialogue } from '../api/voiceHooks.js';
import { DialogueModal } from './DialogueModal.js';
import { ErrorNote, useLocalStorage } from './ui.js';
import {
  SPEED_OPTIONS,
  formatSpeed,
  sortVoices,
  useReadingSettings,
  useVoices,
  voiceLabel,
} from '../reading/settings.js';
import { kokoroVoiceLabel, sortKokoroVoices, useKokoro } from '../reading/kokoro.js';
import { buildSegments, splitParagraphs } from '../reading/text.js';
import { useReader, type Reader } from '../reading/useReader.js';
import { voiceForSegment, type VoiceCast } from '../reading/voices.js';

/**
 * Manuscript text with a read-aloud bar above it. While reading, the current
 * paragraph is highlighted and clicking any paragraph reads from there.
 */
export function ReadableText({
  text,
  className = '',
  autoStart = false,
  onFinished,
  versionId,
  chapterId,
}: {
  text: string;
  className?: string;
  /** Start reading as soon as the text appears, used when moving on to the next chapter. */
  autoStart?: boolean;
  onFinished?: () => void;
  /** The version being shown. With it, characters' lines can be read in their own voices. */
  versionId?: string;
  /** The chapter this text belongs to, so voices can be assigned to it. */
  chapterId?: string;
}) {
  const { projectId = '' } = useParams();
  const [settings] = useReadingSettings();
  const wantVoices = settings.engine === 'kokoro' && settings.characterVoices && Boolean(versionId) && Boolean(projectId);
  const { data: graph } = useProjectGraph(projectId, { enabled: wantVoices });
  const { data: kokoroInfo } = useKokoro(wantVoices);
  const dialogue = useDialogue(versionId, wantVoices);
  const attribution = wantVoices ? (dialogue.data ?? null) : null;
  const characters = graph?.characters ?? [];

  const paragraphs = useMemo(() => splitParagraphs(text), [text]);
  const segments = useMemo(() => buildSegments(paragraphs, attribution?.quotes), [paragraphs, attribution]);

  const cast = useMemo<VoiceCast>(
    () => ({
      fallback: settings.kokoroVoice,
      narratorId: attribution?.narratorId ?? null,
      voices: new Map(characters.flatMap((c) => (c.voice ? [[c.id, c.voice] as const] : []))),
      available: kokoroInfo?.voices.length ? new Set(kokoroInfo.voices.map((v) => v.id)) : null,
    }),
    [settings.kokoroVoice, attribution, characters, kokoroInfo],
  );
  const voiceFor = useCallback((segment: Parameters<typeof voiceForSegment>[0]) => voiceForSegment(segment, cast), [cast]);
  const reader = useReader(segments, onFinished, attribution ? voiceFor : undefined);
  const [reviewing, setReviewing] = useState(false);
  const paragraphRefs = useRef<Array<HTMLParagraphElement | null>>([]);
  const reading = reader.status !== 'idle';

  useEffect(() => {
    if (autoStart && segments.length > 0) reader.play();
    // Only on mount: a later version switch should not start talking.
  }, []);

  useEffect(() => {
    if (reader.status !== 'playing' || reader.paragraph === null || !settings.autoScroll) return;
    const element = paragraphRefs.current[reader.paragraph];
    if (!element) return;
    const rect = element.getBoundingClientRect();
    // Leave room for the sticky bar at the top.
    if (rect.top < 72 || rect.bottom > window.innerHeight - 24) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [reader.paragraph, reader.status, settings.autoScroll]);

  return (
    <div className="space-y-2">
      {wantVoices && dialogue.isSuccess && !attribution ? (
        <VoiceHint projectId={projectId} chapterId={chapterId} characters={characters} />
      ) : null}
      {reader.supported && segments.length > 0 ? (
        <ReaderBar
          reader={reader}
          total={paragraphs.length}
          onReviewVoices={attribution && versionId ? () => setReviewing(true) : undefined}
        />
      ) : null}
      {reader.error ? <p className="text-xs text-red-600">{reader.error}</p> : null}
      <article className={className}>
        {paragraphs.map((paragraph, index) => (
          <p
            key={index}
            ref={(element) => {
              paragraphRefs.current[index] = element;
            }}
            className={`-mx-2 rounded px-2 whitespace-pre-wrap transition-colors ${
              settings.highlight && reader.paragraph === index ? 'bg-lamp-400/20' : ''
            } ${reading ? 'cursor-pointer hover:bg-ink-100/70' : ''}`}
            title={reading ? 'Read from here' : undefined}
            onClick={() => {
              // Selecting text should not jump the reader.
              if (reading && !window.getSelection()?.toString()) reader.readFromParagraph(index);
            }}
          >
            {paragraph}
          </p>
        ))}
      </article>

      {attribution && versionId ? (
        <DialogueModal
          open={reviewing}
          onClose={() => setReviewing(false)}
          projectId={projectId}
          chapterId={chapterId}
          versionId={versionId}
          text={text}
          attribution={attribution}
          characters={characters}
        />
      ) : null}
    </div>
  );
}

/**
 * Shown above text that has not had its dialogue assigned to characters. It
 * stays out of the way for authors who do not use character voices.
 */
function VoiceHint({
  projectId,
  chapterId,
  characters,
}: {
  projectId: string;
  chapterId?: string;
  characters: Array<{ voice: string | null }>;
}) {
  const [hidden, setHidden] = useLocalStorage('storytime.hideVoiceHint', false);
  const assign = useAssignVoices(projectId);
  if (hidden || characters.length === 0) return null;

  const cast = characters.some((c) => c.voice);
  return (
    <div className="space-y-2 rounded-md border border-ink-200 bg-ink-50 px-3 py-2 text-xs text-ink-600">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          {cast
            ? 'This is read in one voice. Work out who speaks each line to give characters their own.'
            : 'Give your characters voices and they can read their own lines.'}
        </span>
        {cast ? (
          <button
            className="btn-secondary shrink-0 text-xs"
            disabled={assign.isPending}
            onClick={() => assign.mutate({ chapterIds: chapterId ? [chapterId] : undefined })}
          >
            {assign.isPending ? 'Assigning…' : 'Assign voices'}
          </button>
        ) : (
          <Link to={`/p/${projectId}/characters`} className="btn-secondary shrink-0 text-xs">
            Choose voices
          </Link>
        )}
        <button className="btn-ghost shrink-0 text-xs" onClick={() => setHidden(true)}>
          Hide
        </button>
      </div>
      <ErrorNote error={assign.error} />
    </div>
  );
}

function ReaderBar({
  reader,
  total,
  onReviewVoices,
}: {
  reader: Reader;
  total: number;
  onReviewVoices?: () => void;
}) {
  const [settings, update] = useReadingSettings();
  const kokoro = settings.engine === 'kokoro';
  const voices = useVoices();
  const sorted = useMemo(() => sortVoices(voices), [voices]);
  const { data: kokoroInfo } = useKokoro(kokoro);
  const kokoroVoices = useMemo(() => sortKokoroVoices(kokoroInfo?.voices ?? []), [kokoroInfo]);
  const reading = reader.status !== 'idle';
  const speeds = SPEED_OPTIONS.includes(settings.rate) ? SPEED_OPTIONS : [...SPEED_OPTIONS, settings.rate].sort((a, b) => a - b);

  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 rounded-lg border border-ink-200 bg-white/95 px-2 py-1.5 shadow-sm backdrop-blur">
      {reader.status === 'playing' ? (
        <button className="btn-primary text-xs" onClick={reader.pause} aria-label="Pause reading">
          ❚❚ Pause
        </button>
      ) : (
        <button className="btn-primary text-xs" onClick={reader.play} aria-label={reading ? 'Resume reading' : 'Read aloud'}>
          ▶ {reading ? 'Resume' : 'Listen'}
        </button>
      )}

      {reading ? (
        <>
          <button className="btn-ghost px-2 text-xs" onClick={reader.previousParagraph} aria-label="Previous paragraph" title="Previous paragraph">
            ⏮
          </button>
          <button className="btn-ghost px-2 text-xs" onClick={reader.nextParagraph} aria-label="Next paragraph" title="Next paragraph">
            ⏭
          </button>
          <button className="btn-ghost px-2 text-xs" onClick={reader.stop} aria-label="Stop reading" title="Stop">
            ■
          </button>
          <span className="px-1 text-xs text-ink-400 tabular-nums">
            {(reader.paragraph ?? 0) + 1} / {total}
          </span>
          {reader.buffering ? (
            <span className="px-1 text-xs text-ink-400" role="status">
              {kokoroInfo?.status === 'ready' ? 'Preparing voice…' : 'Loading the voice model…'}
            </span>
          ) : null}
        </>
      ) : null}

      <div className="ml-auto flex min-w-0 items-center gap-1.5">
        <select
          className="rounded border border-ink-200 bg-white px-1.5 py-1 text-xs text-ink-700"
          value={settings.rate}
          onChange={(e) => update({ rate: Number(e.target.value) })}
          aria-label="Reading speed"
          title="Reading speed"
        >
          {speeds.map((rate) => (
            <option key={rate} value={rate}>
              {formatSpeed(rate)}
            </option>
          ))}
        </select>
        {kokoro ? (
          <select
            className="max-w-[14rem] min-w-0 truncate rounded border border-ink-200 bg-white px-1.5 py-1 text-xs text-ink-700"
            value={settings.kokoroVoice}
            onChange={(e) => update({ kokoroVoice: e.target.value })}
            aria-label="Reading voice"
            title="Reading voice"
          >
            {kokoroVoices.length === 0 ? <option value={settings.kokoroVoice}>{settings.kokoroVoice}</option> : null}
            {kokoroVoices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {kokoroVoiceLabel(voice)}
              </option>
            ))}
          </select>
        ) : (
          <select
            className="max-w-[14rem] min-w-0 truncate rounded border border-ink-200 bg-white px-1.5 py-1 text-xs text-ink-700"
            value={settings.voiceURI}
            onChange={(e) => update({ voiceURI: e.target.value })}
            aria-label="Reading voice"
            title="Reading voice"
          >
            <option value="">Default voice</option>
            {sorted.map((voice) => (
              <option key={voice.voiceURI} value={voice.voiceURI}>
                {voiceLabel(voice)}
              </option>
            ))}
          </select>
        )}
        {onReviewVoices ? (
          <button className="btn-ghost px-2 text-xs" onClick={onReviewVoices} title="Check who speaks each line">
            Voices
          </button>
        ) : null}
        <Link to="/settings#reading" className="btn-ghost px-2 text-xs" title="More reading settings" aria-label="More reading settings">
          ⚙
        </Link>
      </div>
    </div>
  );
}
