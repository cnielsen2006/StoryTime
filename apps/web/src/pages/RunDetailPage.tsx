import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import type { OutlineResult } from '@storytime/shared';
import { useApplyOutline, useCancelRun, useRun } from '../api/hooks.js';
import { useRunStream } from '../api/sse.js';
import { ErrorNote, Spinner, StreamingText, formatWhen } from '../components/ui.js';

export function RunDetailPage() {
  const { projectId = '', runId = '' } = useParams();
  const navigate = useNavigate();

  const stream = useRunStream(runId);
  const { data: run } = useRun(runId, !stream.finished);
  const cancelRun = useCancelRun();
  const applyOutline = useApplyOutline(projectId);

  const running = run?.status === 'running' || run?.status === 'queued';

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">
            {run ? describeRun(run.mode, run.kind) : 'Generation run'}
          </h2>
          <p className="mt-1 text-sm text-ink-500">
            {run ? (
              <>
                {run.provider} · {run.model} · effort {run.effort}
                {run.createdAt ? ` · started ${formatWhen(run.createdAt)}` : ''}
              </>
            ) : (
              'Loading…'
            )}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <Link to={`/p/${projectId}/runs`} className="btn-secondary">
            All runs
          </Link>
          {running ? (
            <button className="btn-danger" onClick={() => cancelRun.mutate(runId)} disabled={cancelRun.isPending}>
              Cancel
            </button>
          ) : null}
        </div>
      </div>

      <StatusBanner
        status={run?.status}
        streamStatus={stream.status}
        outcome={stream.outcome}
        error={stream.error ?? (run?.error ? { message: run.error, retryable: false } : null)}
      />

      {stream.outline ? (
        <OutlinePanel
          outline={stream.outline}
          onApply={async () => {
            const result = await applyOutline.mutateAsync(stream.outline);
            if (result.warnings.length) window.alert(result.warnings.join('\n'));
            navigate(`/p/${projectId}/manuscript`);
          }}
          applying={applyOutline.isPending}
          error={applyOutline.error}
        />
      ) : null}

      {stream.targets.length > 0 ? (
        <div className="space-y-4">
          {stream.targets.map((target) => (
            <div key={target.targetId}>
              <div className="mb-1.5 flex items-center gap-2">
                <h3 className="text-sm font-semibold text-ink-800">{target.label}</h3>
                {target.done ? (
                  <span className="chip border-emerald-200 bg-emerald-50 text-emerald-700">
                    done · {target.wordCount.toLocaleString()} words
                  </span>
                ) : (
                  <span className="chip">writing…</span>
                )}
              </div>
              <StreamingText text={target.text} />
            </div>
          ))}
        </div>
      ) : null}

      {!stream.outline && stream.targets.length === 0 && running ? (
        <div className="card p-6">
          <Spinner label={stream.status ?? 'Assembling the story bible'} />
        </div>
      ) : null}

      {stream.usage ? (
        <div className="card p-4">
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-ink-500 uppercase">Tokens used</h3>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-ink-400">Sent</dt>
              <dd className="font-medium text-ink-800">{stream.usage.inputTokens.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-400">Generated</dt>
              <dd className="font-medium text-ink-800">{stream.usage.outputTokens.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-400">Read from cache</dt>
              <dd className="font-medium text-ink-800">{stream.usage.cacheReadTokens.toLocaleString()}</dd>
            </div>
          </dl>
        </div>
      ) : null}

      {run?.bibleMarkdown ? <BibleSnapshot markdown={run.bibleMarkdown} /> : null}

      {stream.finished && stream.outcome === 'succeeded' && !stream.outline ? (
        <Link to={`/p/${projectId}/manuscript`} className="btn-primary">
          Read it in the manuscript
        </Link>
      ) : null}
    </div>
  );
}

function describeRun(mode: string, kind: string): string {
  if (kind === 'outline') return mode === 'scenes' ? 'Planning chapters and scenes' : 'Planning the chapter outline';
  if (kind === 'update') return 'Revising with instructions';
  if (mode === 'draft') return 'Writing the whole draft';
  if (mode === 'scenes') return 'Writing scenes';
  return 'Writing chapters';
}

function StatusBanner({
  status,
  streamStatus,
  outcome,
  error,
}: {
  status?: string;
  streamStatus: string | null;
  outcome: 'succeeded' | 'cancelled' | null;
  error: { message: string; retryable: boolean } | null;
}) {
  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        <strong className="font-semibold">This run stopped.</strong> {error.message}
        {error.retryable ? <p className="mt-1 text-xs">This looks temporary. Running it again may work.</p> : null}
      </div>
    );
  }
  if (outcome === 'cancelled' || status === 'cancelled') {
    return (
      <div className="rounded-md border border-ink-200 bg-ink-100 px-4 py-3 text-sm text-ink-700">
        Cancelled. Nothing was saved.
      </div>
    );
  }
  if (outcome === 'succeeded' || status === 'succeeded') {
    return (
      <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        Finished.
      </div>
    );
  }
  return (
    <div className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
      {streamStatus ?? 'Running…'}
    </div>
  );
}

/** The generated plan, reviewable before it becomes real chapters. */
function OutlinePanel({
  outline,
  onApply,
  applying,
  error,
}: {
  outline: OutlineResult;
  onApply: () => void;
  applying: boolean;
  error: unknown;
}) {
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center gap-3">
        <h3 className="text-sm font-semibold text-ink-800">
          Proposed outline · {outline.chapters.length} chapters
        </h3>
        <button className="btn-primary ml-auto" onClick={onApply} disabled={applying}>
          {applying ? 'Saving…' : 'Accept and create chapters'}
        </button>
      </div>

      <ErrorNote error={error} />

      <ol className="space-y-3">
        {outline.chapters.map((chapter, index) => (
          <li key={index} className="rounded-md border border-ink-200 p-3">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold text-ink-400">{index + 1}</span>
              <h4 className="font-medium text-ink-900">{chapter.title}</h4>
              <span className="ml-auto text-xs text-ink-400">~{chapter.estimatedWords.toLocaleString()} words</span>
            </div>
            <p className="mt-1 text-sm text-ink-600">{chapter.summary}</p>
            {chapter.scenes.length > 0 ? (
              <ul className="mt-2 space-y-1 border-l-2 border-ink-200 pl-3">
                {chapter.scenes.map((scene, sceneIndex) => (
                  <li key={sceneIndex} className="text-xs text-ink-500">
                    <span className="font-medium text-ink-700">{scene.title}</span>
                    {scene.goal ? ` — ${scene.goal}` : ''}
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>

      <p className="mt-3 text-xs text-ink-400">
        Accepting creates these chapters. You can rename, reorder, and edit them before writing any prose.
      </p>
    </div>
  );
}

function BibleSnapshot({ markdown }: { markdown: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button className="btn-ghost text-xs" onClick={() => setOpen((v) => !v)}>
        {open ? 'Hide' : 'Show'} the story bible this run used
      </button>
      {open ? (
        <pre className="mt-2 max-h-96 overflow-auto rounded-md border border-ink-200 bg-ink-50 p-3 text-xs whitespace-pre-wrap text-ink-700">
          {markdown}
        </pre>
      ) : null}
    </div>
  );
}
