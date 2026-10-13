import { useEffect, useMemo, useRef, useState } from 'react';
import type { AppliedRevision, ChatScope, RevisionChatMessage } from '@storytime/shared';
import { useCancelRun, useMakeVersionCurrent, useProjectGraph, useVersionDiff } from '../api/hooks.js';
import { useClearChat, useRefreshAfterChat, useRevisionChat, useSendChat } from '../api/chatHooks.js';
import { useRunStream } from '../api/sse.js';
import { ErrorNote, Spinner, formatWhen, useLocalStorage } from './ui.js';

const SUGGESTIONS: Record<ChatScope['scopeType'], string[]> = {
  chapter: [
    'Tighten the prose and cut anything that repeats.',
    'Make the dialogue sound more natural.',
    'Does the opening hook the reader? What would you change?',
    'Strengthen the ending.',
  ],
  scene: ['Tighten this scene.', 'Make the setting more vivid.', 'Where does the tension sag?'],
  draft: ['Which chapters drag?', 'Make the opening more gripping.', 'Tighten the prose throughout.'],
  book: [
    'Which chapters are weakest, and why?',
    'Revise the first chapter so it opens colder.',
    'Where does the pacing sag?',
  ],
};

/**
 * A conversation with the model about one piece of the manuscript. It answers
 * questions, and when asked to change something it rewrites the text as a new
 * version, so the author can keep iterating, compare, and undo.
 */
export function RevisionChatPanel({
  projectId,
  scope,
  title,
  onClose,
}: {
  projectId: string;
  scope: ChatScope;
  /** What the conversation is about, e.g. the chapter's title. */
  title: string;
  onClose: () => void;
}) {
  const [runId, setRunId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [attribute, setAttribute] = useLocalStorage<boolean>('storytime:attribute-dialogue', true);

  const history = useRevisionChat(projectId, scope, runId !== null);
  const send = useSendChat(projectId, scope);
  const clear = useClearChat(projectId, scope);
  const refresh = useRefreshAfterChat(projectId, scope);
  const cancel = useCancelRun();
  const stream = useRunStream(runId ?? undefined);

  const messages = history.data?.messages ?? [];
  const last = messages.at(-1);
  // A turn begun elsewhere, or before a reload, is still being answered.
  const waiting = runId !== null || send.isPending || last?.role === 'user';
  const endRef = useRef<HTMLDivElement>(null);

  // Once the run ends, pick up the stored reply and any rewritten text, then drop the live bubble.
  useEffect(() => {
    if (!runId || !stream.finished) return;
    let current = true;
    void refresh().then(() => {
      if (current) setRunId(null);
    });
    return () => {
      current = false;
    };
  }, [runId, stream.finished]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length, stream.reply, runId]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // A dialog opened over the panel (a diff, a confirmation) takes Escape first.
      if (event.key === 'Escape' && !document.querySelector('[role="dialog"]')) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = async () => {
    const message = draft.trim();
    if (!message || waiting) return;
    try {
      const started = await send.mutateAsync({ message, attributeDialogue: attribute });
      setDraft('');
      setRunId(started.runId);
    } catch {
      // The error is shown from the mutation.
    }
  };

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-ink-200 bg-white shadow-2xl"
      aria-label="Revise with AI"
    >
      <header className="flex items-start gap-2 border-b border-ink-200 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-ink-900">Revise with AI</h2>
          <p className="truncate text-xs text-ink-500">{title}</p>
        </div>
        {messages.length > 0 ? (
          <button
            className="btn-ghost text-xs"
            disabled={clear.isPending || waiting}
            title="Forget this conversation. The text and its versions are not touched."
            onClick={() => {
              if (window.confirm('Start the conversation over? The text and every version stay as they are.')) clear.mutate();
            }}
          >
            Clear
          </button>
        ) : null}
        <button className="btn-ghost px-2 text-xs" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" role="log" aria-live="polite">
        {history.isLoading ? <Spinner /> : null}
        <ErrorNote error={history.error} />

        {history.isSuccess && messages.length === 0 && runId === null ? (
          <div className="space-y-3 text-sm text-ink-500">
            <p>
              Tell the model what you want to change, or ask what it thinks. When you ask for a change it rewrites the
              text as a new version, and you can keep going from there. Nothing is ever lost: every version is kept and
              you can undo any change.
            </p>
            <ul className="space-y-1.5">
              {SUGGESTIONS[scope.scopeType].map((suggestion) => (
                <li key={suggestion}>
                  <button className="chip hover:bg-ink-100" onClick={() => setDraft(suggestion)}>
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {messages.map((message) => (
          <Bubble key={message.id} message={message} projectId={projectId} />
        ))}

        {runId !== null ? (
          <div className="max-w-[90%] rounded-lg bg-ink-100 px-3 py-2 text-sm text-ink-800">
            {stream.reply ? <p className="whitespace-pre-wrap">{stream.reply}</p> : null}
            <div className="flex items-center gap-2 text-xs text-ink-500">
              <Spinner label={stream.status ?? 'Thinking it over'} />
              <button className="btn-ghost text-xs" onClick={() => cancel.mutate(runId)}>
                Stop
              </button>
            </div>
          </div>
        ) : last?.role === 'user' ? (
          <p className="text-xs text-ink-400">Waiting for the reply…</p>
        ) : null}
        <div ref={endRef} />
      </div>

      <footer className="space-y-2 border-t border-ink-200 px-4 py-3">
        <ErrorNote error={send.error} />
        <textarea
          className="field resize-none"
          rows={3}
          value={draft}
          placeholder="Tighten the opening and make the last line land harder…"
          aria-label="Your message"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div className="flex items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-ink-500">
            <input type="checkbox" checked={attribute} onChange={(e) => setAttribute(e.target.checked)} />
            <span className="truncate" title="Work out who speaks each line of any text it rewrites, so characters can read their own dialogue.">
              Assign dialogue voices to rewritten text
            </span>
          </label>
          <button className="btn-primary" onClick={submit} disabled={!draft.trim() || waiting}>
            Send
          </button>
        </div>
      </footer>
    </aside>
  );
}

function Bubble({ message, projectId }: { message: RevisionChatMessage; projectId: string }) {
  if (message.role === 'user') {
    return (
      <div className="ml-auto max-w-[90%] rounded-lg bg-ink-800 px-3 py-2 text-sm whitespace-pre-wrap text-white">
        {message.content}
      </div>
    );
  }

  return (
    <div className="max-w-[90%] space-y-2">
      {message.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {message.error}
        </div>
      ) : null}
      {message.content ? (
        <div className="rounded-lg bg-ink-100 px-3 py-2 text-sm whitespace-pre-wrap text-ink-800">{message.content}</div>
      ) : null}
      {message.applied.length > 0 ? <Applied applied={message.applied} projectId={projectId} /> : null}
      <p className="text-[11px] text-ink-400">{formatWhen(message.createdAt)}</p>
    </div>
  );
}

/** What a reply rewrote, with a way to see the change and to take it back. */
function Applied({ applied, projectId }: { applied: AppliedRevision[]; projectId: string }) {
  const { data: graph } = useProjectGraph(projectId);
  const makeCurrent = useMakeVersionCurrent(projectId);
  const [showing, setShowing] = useState<string | null>(null);

  const current = useMemo(
    () =>
      new Set([
        ...(graph?.chapters ?? []).map((c) => c.currentVersionId),
        ...(graph?.scenes ?? []).map((s) => s.currentVersionId),
      ]),
    [graph],
  );

  return (
    <ul className="space-y-1.5">
      {applied.map((revision) => {
        // Drafts have no "current version" to point back at; their newest version is simply the one shown.
        const switchable = revision.targetType === 'chapter' || revision.targetType === 'scene';
        const isCurrent = current.has(revision.versionId);
        return (
          <li key={revision.versionId} className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium">Rewrote {revision.label}</span>
              <span className="text-emerald-700">{revision.wordCount.toLocaleString()} words</span>
              <span className="ml-auto flex gap-1">
                {revision.previousVersionId ? (
                  <button
                    className="btn-ghost px-1.5 py-0.5 text-xs"
                    onClick={() => setShowing(showing === revision.versionId ? null : revision.versionId)}
                  >
                    {showing === revision.versionId ? 'Hide changes' : 'Show changes'}
                  </button>
                ) : null}
                {switchable && isCurrent && revision.previousVersionId ? (
                  <button
                    className="btn-ghost px-1.5 py-0.5 text-xs"
                    disabled={makeCurrent.isPending}
                    onClick={() => makeCurrent.mutate(revision.previousVersionId!)}
                  >
                    Undo
                  </button>
                ) : null}
                {switchable && !isCurrent && graph ? (
                  <button
                    className="btn-ghost px-1.5 py-0.5 text-xs"
                    disabled={makeCurrent.isPending}
                    onClick={() => makeCurrent.mutate(revision.versionId)}
                  >
                    Use this version
                  </button>
                ) : null}
              </span>
            </div>
            {showing === revision.versionId && revision.previousVersionId ? (
              <Changes before={revision.previousVersionId} after={revision.versionId} />
            ) : null}
          </li>
        );
      })}
      <ErrorNote error={makeCurrent.error} />
    </ul>
  );
}

function Changes({ before, after }: { before: string; after: string }) {
  const { data: diff, isLoading, error } = useVersionDiff(before, after);
  return (
    <div className="mt-2 max-h-64 overflow-y-auto rounded border border-emerald-200 bg-white p-2 text-xs whitespace-pre-wrap text-ink-700">
      {isLoading ? <Spinner /> : null}
      <ErrorNote error={error} />
      {diff?.lines.map((line, index) => (
        <span
          key={index}
          className={
            line.type === 'added'
              ? 'bg-green-100 text-green-900'
              : line.type === 'removed'
                ? 'bg-red-100 text-red-900 line-through'
                : 'text-ink-500'
          }
        >
          {line.value}
        </span>
      ))}
    </div>
  );
}
