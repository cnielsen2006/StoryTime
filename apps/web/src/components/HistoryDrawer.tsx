import { useState } from 'react';
import { useRestoreRevision, useRevision, useRevisions } from '../api/hooks.js';
import { ErrorNote, Modal, Spinner, formatWhen } from './ui.js';

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value || '—';
  if (Array.isArray(value)) return value.length ? JSON.stringify(value, null, 2) : '—';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

/**
 * Change history for one bible entity: what changed, when, and the ability to
 * put an earlier version back.
 */
export function HistoryDrawer({
  open,
  onClose,
  projectId,
  entityType,
  entityId,
  title,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  entityType: string;
  entityId: string | undefined;
  title: string;
}) {
  const [selected, setSelected] = useState<string | undefined>();
  const { data: revisions, isLoading } = useRevisions(entityType, open ? entityId : undefined);
  const { data: detail } = useRevision(selected);
  const restore = useRestoreRevision(projectId);

  return (
    <Modal open={open} title={`History: ${title}`} onClose={onClose} wide>
      <div className="grid gap-5 sm:grid-cols-[16rem_1fr]">
        <div className="space-y-1">
          {isLoading ? <Spinner /> : null}
          {revisions?.length === 0 ? <p className="text-sm text-ink-500">No changes recorded yet.</p> : null}
          {revisions?.map((revision) => (
            <button
              key={revision.id}
              onClick={() => setSelected(revision.id)}
              className={`w-full rounded-md border px-3 py-2 text-left text-sm ${
                selected === revision.id
                  ? 'border-ink-400 bg-ink-100'
                  : 'border-ink-200 bg-white hover:border-ink-300'
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span className="font-medium text-ink-800">Revision {revision.revision}</span>
                <span className="text-xs text-ink-400">{formatWhen(revision.createdAt)}</span>
              </div>
              <p className="mt-0.5 truncate text-xs text-ink-500">{revision.summary}</p>
            </button>
          ))}
        </div>

        <div>
          {!detail ? (
            <p className="text-sm text-ink-500">Pick a revision to see what changed.</p>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-ink-800">Revision {detail.revision}</h3>
                {!detail.deleted ? (
                  <button
                    className="btn-secondary ml-auto text-xs"
                    disabled={restore.isPending}
                    onClick={async () => {
                      if (!window.confirm('Bring this version back? It is saved as a new revision, so nothing is lost.'))
                        return;
                      await restore.mutateAsync(detail.id);
                    }}
                  >
                    {restore.isPending ? 'Restoring…' : 'Restore this version'}
                  </button>
                ) : null}
              </div>

              <ErrorNote error={restore.error} />

              {detail.changedFields.length === 0 ? (
                <p className="text-sm text-ink-500">No field-level changes recorded.</p>
              ) : (
                <div className="space-y-3">
                  {detail.changedFields.map((field) => (
                    <div key={field} className="rounded-md border border-ink-200">
                      <div className="border-b border-ink-200 bg-ink-50 px-3 py-1.5 text-xs font-semibold text-ink-600">
                        {field}
                      </div>
                      <div className="grid gap-px bg-ink-200 sm:grid-cols-2">
                        <div className="bg-red-50 p-3">
                          <div className="mb-1 text-xs font-medium text-red-700">Before</div>
                          <pre className="text-xs whitespace-pre-wrap text-ink-700">
                            {renderValue(detail.previousSnapshot?.[field])}
                          </pre>
                        </div>
                        <div className="bg-green-50 p-3">
                          <div className="mb-1 text-xs font-medium text-green-700">After</div>
                          <pre className="text-xs whitespace-pre-wrap text-ink-700">
                            {renderValue(detail.snapshot[field])}
                          </pre>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

/** Raw ideas that were filed against this entity. */
export function LinkedIdeas({ ideas }: { ideas?: Array<{ id: string; text: string; note: string | null }> }) {
  if (!ideas || ideas.length === 0) return null;
  return (
    <div className="card p-4">
      <h4 className="mb-2 text-xs font-semibold tracking-wide text-ink-500 uppercase">From the inbox</h4>
      <ul className="space-y-2">
        {ideas.map((idea) => (
          <li key={idea.id} className="border-l-2 border-ink-200 pl-3 text-sm text-ink-600">
            {idea.text}
            {idea.note ? <p className="mt-0.5 text-xs text-ink-400">{idea.note}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
