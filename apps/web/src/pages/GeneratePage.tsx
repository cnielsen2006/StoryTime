import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { GenerationMode, RunPreview } from '@storytime/shared';
import {
  useChapters,
  useProjectGraph,
  usePreviewRun,
  useStartRun,
} from '../api/hooks.js';
import { ErrorNote, Select, Spinner, TextArea, useLocalStorage } from '../components/ui.js';

interface ModeCard {
  mode: GenerationMode;
  title: string;
  blurb: string;
  bestFor: string;
}

const MODES: ModeCard[] = [
  {
    mode: 'draft',
    title: 'Whole draft',
    blurb: 'One pass, start to finish. The model writes the entire manuscript in a single go.',
    bestFor: 'Short work: a novella, a long short story, or a first look at whether the premise holds.',
  },
  {
    mode: 'chapters',
    title: 'Outline, then chapters',
    blurb: 'Plan the chapters first, edit the plan, then write them one at a time with continuity carried forward.',
    bestFor: 'Full-length books. Rewriting one chapter leaves the rest untouched.',
  },
  {
    mode: 'scenes',
    title: 'Scene cards',
    blurb: 'Break chapters into scenes with a point of view, a place, and a goal each, then write scene by scene.',
    bestFor: 'Maximum control, when you care exactly where each beat lands.',
  },
];

export function GeneratePage() {
  const { projectId = '' } = useParams();
  const navigate = useNavigate();

  const { data: graph } = useProjectGraph(projectId);
  const { data: chapters } = useChapters(projectId);

  const [mode, setMode] = useLocalStorage<GenerationMode>(`storytime:mode:${projectId}`, 'chapters');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [instructions, setInstructions] = useState('');
  const [effort, setEffort] = useState('');
  const [targetWords, setTargetWords] = useState('');
  const [chapterHint, setChapterHint] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<RunPreview | null>(null);

  const previewRun = usePreviewRun(projectId);
  const startRun = useStartRun(projectId);

  const hasOutline = (chapters?.length ?? 0) > 0;
  const hasScenes = (graph?.counts.scenes ?? 0) > 0;

  /** Outline first when the mode needs one and none exists yet. */
  const kind: 'outline' | 'generate' =
    mode === 'draft' ? 'generate' : mode === 'chapters' ? (hasOutline ? 'generate' : 'outline') : hasScenes ? 'generate' : 'outline';

  const payload = () => ({
    mode,
    kind,
    ...(selectedIds.length ? { targetIds: selectedIds } : {}),
    ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
    ...(effort ? { effort } : {}),
    ...(targetWords ? { targetLengthWords: Number(targetWords) } : {}),
    ...(chapterHint ? { chapterCountHint: Number(chapterHint) } : {}),
  });

  const runPreview = async () => {
    const result = await previewRun.mutateAsync(payload());
    setPreview(result);
    setStep(3);
  };

  const start = async () => {
    const { runId } = await startRun.mutateAsync(payload());
    navigate(`/p/${projectId}/runs/${runId}`);
  };

  if (!graph) return <Spinner />;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink-900">Generate</h2>
        <p className="mt-1 text-sm text-ink-500">
          Pick how the model should work through the book. You can choose differently every time.
        </p>
      </div>

      <ol className="flex gap-2 text-xs">
        {(['Approach', 'Scope', 'Check'] as const).map((label, index) => (
          <li
            key={label}
            className={`rounded-full px-3 py-1 ${
              step === index + 1 ? 'bg-ink-800 text-white' : 'bg-ink-100 text-ink-500'
            }`}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <div className="space-y-3">
          {MODES.map((card) => (
            <button
              key={card.mode}
              onClick={() => setMode(card.mode)}
              className={`card w-full p-4 text-left transition-colors ${
                mode === card.mode ? 'border-ink-700 ring-2 ring-ink-200' : 'hover:border-ink-300'
              }`}
            >
              <h3 className="font-semibold text-ink-900">{card.title}</h3>
              <p className="mt-1 text-sm text-ink-600">{card.blurb}</p>
              <p className="mt-1.5 text-xs text-ink-400">Best for: {card.bestFor}</p>
            </button>
          ))}

          {mode === 'draft' && (graph.storyParameters.targetLengthWords ?? 0) > 20_000 ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              This book targets {graph.storyParameters.targetLengthWords?.toLocaleString()} words. A whole draft that
              long will be stitched together from several responses and may show seams. Outline mode handles long books
              better.
            </p>
          ) : null}

          <div className="flex justify-end">
            <button className="btn-primary" onClick={() => setStep(2)}>
              Next
            </button>
          </div>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="space-y-5">
          <div className="card p-4">
            <p className="text-sm text-ink-600">
              {kind === 'outline'
                ? mode === 'scenes'
                  ? 'This run will plan the chapters and their scenes. Nothing is written yet; you can edit the plan before generating prose.'
                  : 'This run will plan the chapter outline. Nothing is written yet; you can edit the plan before generating prose.'
                : mode === 'draft'
                  ? 'This run will write the entire manuscript in one pass.'
                  : mode === 'chapters'
                    ? 'This run will write chapters. By default it writes anything unwritten or needing a rewrite.'
                    : 'This run will write scenes. By default it writes anything unwritten or needing a rewrite.'}
            </p>
          </div>

          {mode === 'draft' || kind === 'outline' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Target length (words)</label>
                <input
                  className="field"
                  type="number"
                  min={100}
                  step={500}
                  value={targetWords}
                  placeholder={graph.storyParameters.targetLengthWords?.toString() ?? 'From story parameters'}
                  onChange={(e) => setTargetWords(e.target.value)}
                />
              </div>
              <div>
                <label className="label">How many chapters</label>
                <input
                  className="field"
                  type="number"
                  min={1}
                  value={chapterHint}
                  placeholder="Let the model choose"
                  onChange={(e) => setChapterHint(e.target.value)}
                />
              </div>
            </div>
          ) : null}

          {kind === 'generate' && mode === 'chapters' && chapters ? (
            <ChapterPicker chapters={chapters} selected={selectedIds} onChange={setSelectedIds} />
          ) : null}

          <Select
            label="Effort"
            hint="Overrides this book's setting for this run only."
            value={effort}
            onChange={setEffort}
            options={[
              { value: '', label: "Use this book's setting" },
              { value: 'low', label: 'Low, fastest and cheapest' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
              { value: 'xhigh', label: 'Very high' },
              { value: 'max', label: 'Maximum, slowest' },
            ]}
          />

          <TextArea
            label="Extra direction for this run"
            hint="Optional. Something you want only this time, not stored in the bible."
            value={instructions}
            onChange={setInstructions}
            rows={3}
            placeholder="Open in the middle of the storm rather than before it."
          />

          <ErrorNote error={previewRun.error} />

          <div className="flex justify-between">
            <button className="btn-secondary" onClick={() => setStep(1)}>
              Back
            </button>
            <button className="btn-primary" onClick={runPreview} disabled={previewRun.isPending}>
              {previewRun.isPending ? 'Checking…' : 'Check before running'}
            </button>
          </div>
        </div>
      ) : null}

      {step === 3 && preview ? (
        <div className="space-y-5">
          <PreviewPanel preview={preview} />
          <ErrorNote error={startRun.error} />
          <div className="flex justify-between">
            <button className="btn-secondary" onClick={() => setStep(2)}>
              Back
            </button>
            <button className="btn-primary" onClick={start} disabled={startRun.isPending}>
              {startRun.isPending ? 'Starting…' : kind === 'outline' ? 'Plan it' : 'Write it'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ChapterPicker({
  chapters,
  selected,
  onChange,
}: {
  chapters: Array<{ id: string; title: string; staleLevel: string; currentVersionId: string | null; wordCount: number }>;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const needsWork = chapters.filter((c) => !c.currentVersionId || c.staleLevel === 'hard');

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="label mb-0">Which chapters</span>
        <div className="ml-auto flex gap-1">
          <button className="btn-ghost text-xs" onClick={() => onChange(needsWork.map((c) => c.id))}>
            Select those needing work ({needsWork.length})
          </button>
          <button className="btn-ghost text-xs" onClick={() => onChange([])}>
            Clear
          </button>
        </div>
      </div>

      <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-ink-200 p-2">
        {chapters.map((chapter, index) => {
          const checked = selected.includes(chapter.id);
          return (
            <li key={chapter.id}>
              <label className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-ink-50">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    onChange(checked ? selected.filter((id) => id !== chapter.id) : [...selected, chapter.id])
                  }
                />
                <span className="text-ink-400">{index + 1}.</span>
                <span className="flex-1 truncate text-ink-800">{chapter.title}</span>
                {!chapter.currentVersionId ? (
                  <span className="text-xs text-ink-400">unwritten</span>
                ) : chapter.staleLevel === 'hard' ? (
                  <span className="text-xs text-red-600">needs rewrite</span>
                ) : chapter.staleLevel === 'soft' ? (
                  <span className="text-xs text-amber-600">background changed</span>
                ) : (
                  <span className="text-xs text-ink-400">{chapter.wordCount.toLocaleString()}w</span>
                )}
              </label>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-xs text-ink-400">
        Select nothing to write everything unwritten or needing a rewrite.
      </p>
    </div>
  );
}

function PreviewPanel({ preview }: { preview: RunPreview }) {
  const [showPrompt, setShowPrompt] = useState(false);
  const overBudget = preview.trim.estimatedTokens > preview.trim.budgetTokens;

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-ink-400">Provider</dt>
            <dd className="font-medium text-ink-800">{preview.provider}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-400">Model</dt>
            <dd className="truncate font-medium text-ink-800" title={preview.model}>
              {preview.model}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-400">Effort</dt>
            <dd className="font-medium text-ink-800">{preview.effort}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-400">Pieces to write</dt>
            <dd className="font-medium text-ink-800">{preview.targetCount}</dd>
          </div>
        </dl>
      </div>

      <div className={`card p-4 ${overBudget ? 'border-red-300' : ''}`}>
        <h3 className="text-sm font-semibold text-ink-800">Story bible in the prompt</h3>
        <p className="mt-1 text-sm text-ink-600">
          Roughly {preview.trim.estimatedTokens.toLocaleString()} tokens of a{' '}
          {preview.trim.budgetTokens.toLocaleString()} token budget, at the{' '}
          <strong>{preview.trim.level}</strong> level of detail.
        </p>
        {preview.trim.notes.length > 0 ? (
          <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-ink-500">
            {preview.trim.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {preview.warnings.length > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-amber-800">Worth knowing</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-amber-800">
            {preview.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div>
        <button className="btn-ghost text-xs" onClick={() => setShowPrompt((v) => !v)}>
          {showPrompt ? 'Hide' : 'Show'} the exact prompt
        </button>
        {showPrompt ? (
          <div className="mt-2 space-y-3">
            <div>
              <h4 className="label">System prompt</h4>
              <pre className="max-h-64 overflow-auto rounded-md border border-ink-200 bg-ink-50 p-3 text-xs whitespace-pre-wrap text-ink-700">
                {preview.systemPrompt}
              </pre>
            </div>
            <div>
              <h4 className="label">Task</h4>
              <pre className="max-h-48 overflow-auto rounded-md border border-ink-200 bg-ink-50 p-3 text-xs whitespace-pre-wrap text-ink-700">
                {preview.taskPrompt}
              </pre>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
