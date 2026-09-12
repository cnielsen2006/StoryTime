import { useState } from 'react';
import { useParams } from 'react-router';
import type { PlotLineWithPoints, PlotPoint, PlotPointStatus } from '@storytime/shared';
import {
  useCharacters,
  useDeletePlotLine,
  useDeletePlotPoint,
  useLocations,
  usePlotLines,
  useSavePlotLine,
  useSavePlotPoint,
} from '../api/hooks.js';
import { EmptyState, ErrorNote, Modal, Select, Spinner, TextArea, TextInput } from '../components/ui.js';

const STATUS_STYLES: Record<PlotPointStatus, string> = {
  idea: 'border-ink-200 bg-ink-50 text-ink-500',
  draft: 'border-sky-200 bg-sky-50 text-sky-700',
  confirmed: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

const STATUS_LABELS: Record<PlotPointStatus, string> = {
  idea: 'Loose idea',
  draft: 'Taking shape',
  confirmed: 'Confirmed',
};

export function PlotPage() {
  const { projectId = '' } = useParams();
  const { data: plotLines, isLoading } = usePlotLines(projectId);
  const [editingPoint, setEditingPoint] = useState<{ point?: PlotPoint; plotLineId: string } | null>(null);
  const [creatingLine, setCreatingLine] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">Plot</h2>
          <p className="mt-1 text-sm text-ink-500">
            Threads and the points along them. Points can stay half-formed; the status says how firm each one is.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setCreatingLine(true)}>
          New plot line
        </button>
      </div>

      {isLoading ? <Spinner /> : null}

      {plotLines && plotLines.length === 0 ? (
        <EmptyState
          title="No plot lines yet"
          body="A plot line is a thread: the main story, a subplot, a piece of backstory that surfaces slowly."
          action={
            <button className="btn-primary" onClick={() => setCreatingLine(true)}>
              Add a plot line
            </button>
          }
        />
      ) : null}

      <div className="space-y-6">
        {plotLines?.map((line) => (
          <PlotLineSection
            key={line.id}
            projectId={projectId}
            line={line}
            onEditPoint={(point) => setEditingPoint({ point, plotLineId: line.id })}
            onAddPoint={() => setEditingPoint({ plotLineId: line.id })}
          />
        ))}
      </div>

      <PlotLineModal open={creatingLine} projectId={projectId} onClose={() => setCreatingLine(false)} />
      <PlotPointModal
        projectId={projectId}
        state={editingPoint}
        onClose={() => setEditingPoint(null)}
      />
    </div>
  );
}

function PlotLineSection({
  projectId,
  line,
  onEditPoint,
  onAddPoint,
}: {
  projectId: string;
  line: PlotLineWithPoints;
  onEditPoint: (point: PlotPoint) => void;
  onAddPoint: () => void;
}) {
  const remove = useDeletePlotLine(projectId);
  const savePoint = useSavePlotPoint(projectId);

  return (
    <section className="card p-5">
      <header className="mb-3 flex items-start gap-3">
        <div>
          <h3 className="font-semibold text-ink-900">
            {line.name} <span className="ml-1 text-xs font-normal text-ink-400">{line.kind}</span>
          </h3>
          {line.description ? <p className="mt-0.5 text-sm text-ink-500">{line.description}</p> : null}
        </div>
        <div className="ml-auto flex gap-1">
          <button className="btn-secondary text-xs" onClick={onAddPoint}>
            Add point
          </button>
          <button
            className="btn-ghost text-xs text-red-500 hover:bg-red-50"
            onClick={() => {
              if (window.confirm(`Delete "${line.name}" and its ${line.points.length} plot point(s)?`)) {
                remove.mutate(line.id);
              }
            }}
          >
            Delete
          </button>
        </div>
      </header>

      {line.points.length === 0 ? (
        <p className="text-sm text-ink-400">No points on this line yet.</p>
      ) : (
        <ol className="space-y-2">
          {line.points.map((point, index) => (
            <li key={point.id} className="flex items-start gap-3 rounded-md border border-ink-200 p-3">
              <span className="mt-0.5 text-xs font-semibold text-ink-400">{index + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <button className="text-sm font-medium text-ink-900 hover:text-ink-600" onClick={() => onEditPoint(point)}>
                    {point.title}
                  </button>
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLES[point.status]}`}>
                    {STATUS_LABELS[point.status]}
                  </span>
                </div>
                {point.summary ? <p className="mt-1 text-sm text-ink-600">{point.summary}</p> : null}
              </div>
              <select
                className="rounded border border-ink-200 px-1.5 py-0.5 text-xs text-ink-600"
                value={point.status}
                title="How firm is this point?"
                onChange={(e) => savePoint.mutate({ id: point.id, status: e.target.value })}
              >
                {(['idea', 'draft', 'confirmed'] as const).map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function PlotLineModal({ open, projectId, onClose }: { open: boolean; projectId: string; onClose: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('main');
  const [description, setDescription] = useState('');
  const save = useSavePlotLine(projectId);

  const submit = async () => {
    if (!name.trim()) return;
    await save.mutateAsync({ name: name.trim(), kind, description: description.trim() || null });
    setName('');
    setDescription('');
    onClose();
  };

  return (
    <Modal open={open} title="New plot line" onClose={onClose}>
      <div className="space-y-4">
        <TextInput label="Name" value={name} onChange={setName} placeholder="What the light keeps out" />
        <Select
          label="Kind"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'main', label: 'Main story' },
            { value: 'subplot', label: 'Subplot' },
            { value: 'backstory', label: 'Backstory' },
          ]}
        />
        <TextArea label="What this thread is about" value={description} onChange={setDescription} rows={3} />
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={!name.trim()}>
            Create
          </button>
        </div>
      </div>
    </Modal>
  );
}

function PlotPointModal({
  projectId,
  state,
  onClose,
}: {
  projectId: string;
  state: { point?: PlotPoint; plotLineId: string } | null;
  onClose: () => void;
}) {
  const { data: characters } = useCharacters(projectId);
  const { data: locations } = useLocations(projectId);
  const save = useSavePlotPoint(projectId);
  const remove = useDeletePlotPoint(projectId);

  const point = state?.point;
  const [draft, setDraft] = useState<Partial<PlotPoint>>({});
  const [initialised, setInitialised] = useState<string | null>(null);

  // Load the selected point into the form the first time it opens.
  const key = point?.id ?? state?.plotLineId ?? '';
  if (state && initialised !== key) {
    setInitialised(key);
    setDraft(
      point ?? { title: '', summary: '', status: 'idea', notes: '', characterIds: [], locationIds: [] },
    );
  }

  const toggle = (field: 'characterIds' | 'locationIds', id: string) => {
    const current = draft[field] ?? [];
    setDraft({ ...draft, [field]: current.includes(id) ? current.filter((v) => v !== id) : [...current, id] });
  };

  const submit = async () => {
    if (!draft.title?.trim() || !state) return;
    await save.mutateAsync({
      id: point?.id,
      plotLineId: state.plotLineId,
      title: draft.title.trim(),
      summary: draft.summary ?? null,
      status: draft.status ?? 'idea',
      notes: draft.notes ?? null,
      characterIds: draft.characterIds ?? [],
      locationIds: draft.locationIds ?? [],
    });
    onClose();
  };

  return (
    <Modal open={Boolean(state)} title={point ? 'Edit plot point' : 'New plot point'} onClose={onClose}>
      <div className="space-y-4">
        <TextInput label="What happens" value={draft.title ?? ''} onChange={(title) => setDraft({ ...draft, title })} />
        <TextArea label="Summary" value={draft.summary ?? ''} onChange={(summary) => setDraft({ ...draft, summary })} rows={3} />
        <Select
          label="How firm is this?"
          hint="Loose ideas are trimmed first when the bible has to fit a smaller prompt."
          value={draft.status ?? 'idea'}
          onChange={(status) => setDraft({ ...draft, status: status as PlotPointStatus })}
          options={[
            { value: 'idea', label: 'Loose idea' },
            { value: 'draft', label: 'Taking shape' },
            { value: 'confirmed', label: 'Confirmed' },
          ]}
        />

        <div>
          <span className="label">Characters involved</span>
          <div className="flex flex-wrap gap-1.5">
            {(characters ?? []).map((character) => {
              const on = (draft.characterIds ?? []).includes(character.id);
              return (
                <button
                  key={character.id}
                  onClick={() => toggle('characterIds', character.id)}
                  className={`rounded-full border px-2.5 py-1 text-xs ${
                    on ? 'border-ink-700 bg-ink-800 text-white' : 'border-ink-200 bg-white text-ink-600 hover:bg-ink-100'
                  }`}
                >
                  {character.name}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <span className="label">Where it happens</span>
          <div className="flex flex-wrap gap-1.5">
            {(locations ?? []).map((location) => {
              const on = (draft.locationIds ?? []).includes(location.id);
              return (
                <button
                  key={location.id}
                  onClick={() => toggle('locationIds', location.id)}
                  className={`rounded-full border px-2.5 py-1 text-xs ${
                    on ? 'border-ink-700 bg-ink-800 text-white' : 'border-ink-200 bg-white text-ink-600 hover:bg-ink-100'
                  }`}
                >
                  {location.name}
                </button>
              );
            })}
          </div>
        </div>

        <TextArea label="Notes" value={draft.notes ?? ''} onChange={(notes) => setDraft({ ...draft, notes })} rows={2} />
        <ErrorNote error={save.error} />

        <div className="flex justify-end gap-2">
          {point ? (
            <button
              className="btn-danger mr-auto"
              onClick={() => {
                if (window.confirm(`Delete "${point.title}"?`)) {
                  remove.mutate(point.id);
                  onClose();
                }
              }}
            >
              Delete
            </button>
          ) : null}
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={!draft.title?.trim() || save.isPending}>
            {point ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
