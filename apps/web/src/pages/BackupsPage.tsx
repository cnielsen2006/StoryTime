import { useRef, useState } from 'react';
import { Link } from 'react-router';
import type { BackupRestoreResult, BackupSummary, RestoreMode } from '@storytime/shared';
import {
  useBackups,
  useCreateBackup,
  useDeleteBackup,
  useRestoreBackup,
  useUploadBackup,
} from '../api/backupHooks.js';
import { useProjects } from '../api/hooks.js';
import { EmptyState, ErrorNote, Modal, Spinner, formatCount, formatWhen } from '../components/ui.js';

const KIND_LABELS: Record<BackupSummary['kind'], string> = {
  manual: 'Manual',
  automatic: 'Automatic',
  'pre-restore': 'Safety backup',
  imported: 'Uploaded',
};

const KIND_HINTS: Record<BackupSummary['kind'], string> = {
  manual: 'Made by you',
  automatic: 'Made automatically; only the newest are kept',
  'pre-restore': 'Made automatically just before a restore overwrote a story; only the newest are kept',
  imported: 'Uploaded from a file',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const backupTitle = (backup: BackupSummary) =>
  backup.label || `Backup of ${formatCount(backup.projects.length, 'story', 'stories')}`;

export function BackupsPage() {
  const { data, isLoading, error } = useBackups();
  const deleteBackup = useDeleteBackup();
  const upload = useUploadBackup();
  const fileInput = useRef<HTMLInputElement>(null);

  const [restoring, setRestoring] = useState<BackupSummary | null>(null);
  const [deleting, setDeleting] = useState<BackupSummary | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    setUploaded(null);
    upload.mutate(file, { onSuccess: (backup) => setUploaded(backupTitle(backup)) });
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-8 flex items-center gap-3">
        <Link to="/" className="text-sm text-ink-400 hover:text-ink-700">
          ← Books
        </Link>
        <h1 className="text-xl font-semibold text-ink-900">Backups</h1>
      </div>

      <div className="space-y-8">
        <BackUpCard />

        <section className="space-y-3" aria-labelledby="history-heading">
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 id="history-heading" className="text-base font-semibold text-ink-900">
                Backup history
              </h2>
              <p className="mt-1 text-sm text-ink-500">
                Every backup is kept until you delete it, so you can go back to any of them.
              </p>
            </div>
            <div>
              <input
                ref={fileInput}
                type="file"
                className="hidden"
                accept=".gz,application/gzip"
                aria-label="Backup file to upload"
                onChange={(e) => {
                  onFile(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
              <button className="btn-secondary" onClick={() => fileInput.current?.click()} disabled={upload.isPending}>
                {upload.isPending ? 'Uploading…' : 'Upload a backup file'}
              </button>
            </div>
          </div>

          <ErrorNote error={error ?? upload.error ?? deleteBackup.error} />
          {uploaded ? (
            <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800" role="status">
              Added “{uploaded}” to the history. Restore it from there when you are ready.
            </p>
          ) : null}
          {isLoading ? <Spinner label="Loading backups" /> : null}

          {data && data.backups.length === 0 ? (
            <EmptyState
              title="No backups yet"
              body="Pick the stories you want to keep safe above and back them up. You can also upload a backup file made on another machine."
            />
          ) : null}

          <ul className="space-y-3">
            {data?.backups.map((backup) => (
              <BackupRow
                key={backup.id}
                backup={backup}
                onRestore={() => setRestoring(backup)}
                onDelete={() => {
                  deleteBackup.reset();
                  setDeleting(backup);
                }}
              />
            ))}
          </ul>

          {data ? (
            <p className="text-xs text-ink-400">
              Backup files are kept in <code className="break-all">{data.dir}</code> on the computer running StoryTime.
            </p>
          ) : null}
        </section>
      </div>

      <RestoreModal backup={restoring} onClose={() => setRestoring(null)} />

      <Modal open={deleting !== null} title="Delete this backup?" onClose={() => setDeleting(null)}>
        {deleting ? (
          <div className="space-y-4">
            <p className="text-sm text-ink-700">
              “{backupTitle(deleting)}” from {formatWhen(deleting.createdAt)} will be removed for good. Your stories are
              not affected.
            </p>
            <ErrorNote error={deleteBackup.error} />
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button
                className="btn-danger"
                disabled={deleteBackup.isPending}
                onClick={() => deleteBackup.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
              >
                {deleteBackup.isPending ? 'Deleting…' : 'Delete backup'}
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function BackUpCard() {
  const { data: projects, isLoading, error } = useProjects();
  const create = useCreateBackup();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [label, setLabel] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const all = projects ?? [];
  const toggle = (id: string, on: boolean) => {
    const next = new Set(picked);
    if (on) next.add(id);
    else next.delete(id);
    setPicked(next);
  };

  const submit = () => {
    setDone(null);
    create.mutate(
      { projectIds: [...picked], label: label.trim() || undefined },
      {
        onSuccess: (backup) => {
          setDone(`Backed up ${formatCount(backup.projects.length, 'story', 'stories')}.`);
          setPicked(new Set());
          setLabel('');
        },
      },
    );
  };

  return (
    <section className="card space-y-4 p-5" aria-labelledby="backup-heading">
      <div>
        <h2 id="backup-heading" className="text-base font-semibold text-ink-900">
          Back up
        </h2>
        <p className="mt-1 text-sm text-ink-500">
          Choose the stories to save. A backup holds everything in them: the bible, every draft, the history, and your
          revision conversations. Settings and sign-in details are never included.
        </p>
      </div>

      <ErrorNote error={error} />
      {isLoading ? <Spinner label="Loading your books" /> : null}
      {projects && all.length === 0 ? <p className="text-sm text-ink-500">There are no stories to back up yet.</p> : null}

      {all.length > 0 ? (
        <fieldset>
          <legend className="sr-only">Stories to back up</legend>
          <div className="mb-2 flex items-center gap-2 text-xs text-ink-500">
            <button type="button" className="btn-ghost text-xs" onClick={() => setPicked(new Set(all.map((p) => p.id)))}>
              Select all
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={() => setPicked(new Set())}>
              Select none
            </button>
          </div>
          <ul className="divide-y divide-ink-100 rounded-md border border-ink-200">
            {all.map((project) => (
              <li key={project.id}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm text-ink-800 hover:bg-ink-50">
                  <input
                    type="checkbox"
                    checked={picked.has(project.id)}
                    onChange={(e) => toggle(project.id, e.target.checked)}
                  />
                  <span className="font-medium">{project.title}</span>
                  <span className="ml-auto text-xs text-ink-500">{formatCount(project.wordCount, 'word')}</span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}

      <div>
        <label className="label" htmlFor="backup-label">
          Label (optional)
        </label>
        <input
          id="backup-label"
          className="field"
          value={label}
          maxLength={200}
          placeholder="Before the big rewrite"
          onChange={(e) => setLabel(e.target.value)}
        />
      </div>

      <ErrorNote error={create.error} />
      {done ? (
        <p className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800" role="status">
          {done}
        </p>
      ) : null}

      <div className="flex justify-end">
        <button className="btn-primary" disabled={picked.size === 0 || create.isPending} onClick={submit}>
          {create.isPending ? 'Backing up…' : `Back up ${picked.size} selected`}
        </button>
      </div>
    </section>
  );
}

function BackupRow({
  backup,
  onRestore,
  onDelete,
}: {
  backup: BackupSummary;
  onRestore: () => void;
  onDelete: () => void;
}) {
  const shown = backup.projects.slice(0, 3);
  const more = backup.projects.length - shown.length;
  return (
    <li className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-ink-900">{backupTitle(backup)}</span>
          <span className="chip" title={KIND_HINTS[backup.kind]}>
            {KIND_LABELS[backup.kind]}
          </span>
        </div>
        <div className="text-xs text-ink-500">
          {formatWhen(backup.createdAt)} · {formatBytes(backup.bytes)}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-sm text-ink-700">
          {shown.map((project) => (
            <span key={project.id} className="chip" title={`${formatCount(project.wordCount, 'word')}`}>
              {project.title}
            </span>
          ))}
          {more > 0 ? <span className="text-xs text-ink-500">+{more} more</span> : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <a className="btn-secondary" href={`/api/backups/${backup.id}/download`} download>
          Download
        </a>
        <button className="btn-secondary" onClick={onRestore}>
          Restore…
        </button>
        <button className="btn-ghost text-red-500 hover:bg-red-50" onClick={onDelete}>
          Delete
        </button>
      </div>
    </li>
  );
}

function RestoreModal({ backup, onClose }: { backup: BackupSummary | null; onClose: () => void }) {
  return (
    <Modal open={backup !== null} title="Restore from backup" onClose={onClose} wide>
      {/* Keyed so each backup opens with fresh choices. */}
      {backup ? <RestoreForm key={backup.id} backup={backup} onClose={onClose} /> : null}
    </Modal>
  );
}

function RestoreForm({ backup, onClose }: { backup: BackupSummary; onClose: () => void }) {
  const { data: current } = useProjects();
  const restore = useRestoreBackup();
  const [result, setResult] = useState<BackupRestoreResult | null>(null);
  const [chosen, setChosen] = useState<Set<string>>(new Set(backup.projects.map((p) => p.id)));
  const [modes, setModes] = useState<Record<string, RestoreMode>>({});

  const existing = new Set((current ?? []).map((p) => p.id));
  const modeOf = (id: string): RestoreMode => modes[id] ?? 'replace';

  const submit = () => {
    restore.mutate(
      {
        id: backup.id,
        projects: backup.projects.filter((p) => chosen.has(p.id)).map((p) => ({ id: p.id, mode: modeOf(p.id) })),
      },
      { onSuccess: setResult },
    );
  };

  if (result) {
    return (
      <div className="space-y-4">
        <p className="text-sm font-semibold text-ink-900" role="status">
          Restored {formatCount(result.restored.length, 'story', 'stories')}.
        </p>
        <ul className="space-y-1 text-sm text-ink-700">
          {result.restored.map((item) => (
            <li key={item.projectId}>
              <Link to={`/p/${item.projectId}`} className="font-medium text-ink-900 underline hover:text-ink-600">
                {item.title}
              </Link>{' '}
              <span className="text-ink-500">
                {item.mode === 'copy' ? '(a new copy)' : item.mode === 'replace' ? '(replaced the current version)' : '(brought back)'}
              </span>
            </li>
          ))}
        </ul>
        {result.safetyBackupId ? (
          <p className="text-sm text-ink-600">
            What was overwritten was saved first as a safety backup, which is at the top of the history now.
          </p>
        ) : null}
        {result.warnings.length > 0 ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            <p className="font-medium">Some things in the file were skipped</p>
            <ul className="mt-1 list-disc pl-5">
              {result.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="flex justify-end">
          <button className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-600">
        “{backupTitle(backup)}”, taken {formatWhen(backup.createdAt)}. Choose which stories to bring back.
      </p>

      <ul className="space-y-3">
        {backup.projects.map((project) => {
          const present = existing.has(project.id);
          const on = chosen.has(project.id);
          return (
            <li key={project.id} className="rounded-md border border-ink-200 p-3">
              <label className="flex cursor-pointer items-center gap-3 text-sm text-ink-900">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => {
                    const next = new Set(chosen);
                    if (e.target.checked) next.add(project.id);
                    else next.delete(project.id);
                    setChosen(next);
                  }}
                />
                <span className="font-semibold">{project.title}</span>
                <span className="ml-auto text-xs text-ink-500">
                  {formatCount(project.wordCount, 'word')} · {formatCount(project.chapters, 'chapter')} ·{' '}
                  {formatCount(project.characters, 'character')}
                </span>
              </label>

              {on && present ? (
                <fieldset className="mt-3 space-y-2 pl-7">
                  <legend className="sr-only">How to restore {project.title}</legend>
                  <label className="flex items-start gap-2 text-sm text-ink-700">
                    <input
                      type="radio"
                      name={`mode-${project.id}`}
                      className="mt-1"
                      checked={modeOf(project.id) === 'replace'}
                      onChange={() => setModes({ ...modes, [project.id]: 'replace' })}
                    />
                    <span>
                      Replace the current version
                      <span className="block text-xs text-ink-500">
                        A safety backup of the current version is taken automatically first.
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 text-sm text-ink-700">
                    <input
                      type="radio"
                      name={`mode-${project.id}`}
                      className="mt-1"
                      checked={modeOf(project.id) === 'copy'}
                      onChange={() => setModes({ ...modes, [project.id]: 'copy' })}
                    />
                    <span>
                      Restore as a copy
                      <span className="block text-xs text-ink-500">
                        Adds a second book and leaves the current one alone.
                      </span>
                    </span>
                  </label>
                </fieldset>
              ) : null}
              {on && !present ? <p className="mt-2 pl-7 text-xs text-ink-500">Will be restored.</p> : null}
            </li>
          );
        })}
      </ul>

      <ErrorNote error={restore.error} />

      <div className="flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" disabled={chosen.size === 0 || restore.isPending} onClick={submit}>
          {restore.isPending ? 'Restoring…' : `Restore ${formatCount(chosen.size, 'story', 'stories')}`}
        </button>
      </div>
    </div>
  );
}
