import { useEffect, useMemo, useState } from 'react';
import { splitParagraphs, type DialogueAttribution } from '@storytime/shared';
import { useAssignVoices, useSaveDialogue } from '../api/voiceHooks.js';
import { ErrorNote, Modal } from './ui.js';

const NARRATOR = '';

/**
 * Check and correct who the model thought was speaking each line. The author's
 * corrections are kept, and a later automatic pass leaves them alone.
 */
export function DialogueModal({
  open,
  onClose,
  projectId,
  chapterId,
  versionId,
  text,
  attribution,
  characters,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** The chapter to redo when the author asks the model to start over. */
  chapterId?: string;
  versionId: string;
  text: string;
  attribution: DialogueAttribution;
  characters: Array<{ id: string; name: string; voice: string | null }>;
}) {
  const paragraphs = useMemo(() => splitParagraphs(text), [text]);
  // A character deleted since the voices were assigned is shown as the narrator, which saving then makes true.
  const known = useMemo(() => new Set(characters.map((c) => c.id)), [characters]);
  const initialNarrator = attribution.narratorId && known.has(attribution.narratorId) ? attribution.narratorId : NARRATOR;
  const initialSpeakers = attribution.quotes.map((q) => (q.speaker && known.has(q.speaker) ? q.speaker : NARRATOR));
  const [narrator, setNarrator] = useState(initialNarrator);
  const [speakers, setSpeakers] = useState<string[]>(initialSpeakers);
  const save = useSaveDialogue(projectId, versionId);
  const redo = useAssignVoices(projectId);

  useEffect(() => {
    if (!open) return;
    setNarrator(initialNarrator);
    setSpeakers(initialSpeakers);
    // Only when the dialog opens or the stored answer changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, attribution]);

  // Compared with what was stored, so a deleted character counts as a change to save.
  const dirty =
    narrator !== (attribution.narratorId ?? NARRATOR) ||
    speakers.some((speaker, index) => speaker !== (attribution.quotes[index]?.speaker ?? NARRATOR));

  const options = (
    <>
      <option value={NARRATOR}>Narrator (nobody on the cast)</option>
      {characters.map((character) => (
        <option key={character.id} value={character.id}>
          {character.name}
          {character.voice ? '' : ' (no voice yet)'}
        </option>
      ))}
    </>
  );

  return (
    <Modal open={open} title="Who speaks each line" onClose={onClose} wide>
      <div className="space-y-4">
        <p className="text-sm text-ink-500">
          Each quoted line is read in its speaker&apos;s voice. Anything marked as the narrator is read in the narrator&apos;s own.
          {attribution.source === 'manual' ? ' You have corrected this one before, so it will not be redone automatically.' : ''}
        </p>

        <div>
          <label className="label" htmlFor="dialogue-narrator">
            Who tells the story?
          </label>
          <select id="dialogue-narrator" className="field max-w-sm" value={narrator} onChange={(e) => setNarrator(e.target.value)}>
            <option value={NARRATOR}>Nobody on the cast (third person)</option>
            {characters.map((character) => (
              <option key={character.id} value={character.id}>
                {character.name} (first person)
              </option>
            ))}
          </select>
        </div>

        {attribution.quotes.length === 0 ? (
          <p className="rounded-md border border-ink-200 bg-ink-50 px-3 py-2 text-sm text-ink-500">
            There is no quoted dialogue in this text.
          </p>
        ) : (
          <ul className="max-h-[50vh] divide-y divide-ink-100 overflow-y-auto rounded-md border border-ink-200">
            {attribution.quotes.map((quote, index) => {
              const line = paragraphs[quote.paragraph]?.slice(quote.start, quote.end) ?? '';
              return (
                <li key={index} className="flex items-center gap-3 px-3 py-2">
                  <span className="w-8 shrink-0 text-right text-xs text-ink-400 tabular-nums">{index + 1}</span>
                  <span className="prose-manuscript min-w-0 flex-1 truncate text-sm text-ink-700" title={line}>
                    {line}
                  </span>
                  <select
                    className="field w-44 shrink-0 py-1 text-xs"
                    value={speakers[index] ?? NARRATOR}
                    aria-label={`Speaker of line ${index + 1}`}
                    onChange={(e) => setSpeakers((prev) => prev.map((s, i) => (i === index ? e.target.value : s)))}
                  >
                    {options}
                  </select>
                </li>
              );
            })}
          </ul>
        )}

        <ErrorNote error={save.error ?? redo.error} />

        <div className="flex flex-wrap items-center justify-between gap-2">
          {chapterId ? (
            <button
              className="btn-ghost text-xs"
              disabled={redo.isPending}
              onClick={() => {
                if (!dirty || window.confirm('Ask the model again? This replaces the changes you have made here.')) {
                  redo.mutate({ chapterIds: [chapterId], reattribute: true }, { onSuccess: onClose });
                }
              }}
            >
              {redo.isPending ? 'Asking the model…' : 'Start over with the model'}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={onClose}>
              Close
            </button>
            <button
              className="btn-primary"
              disabled={!dirty || save.isPending}
              onClick={() =>
                save.mutate(
                  { narratorId: narrator || null, speakers: speakers.map((s) => s || null) },
                  { onSuccess: onClose },
                )
              }
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
