import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import type { Location } from '@storytime/shared';
import { useDeleteLocation, useEntityIdeas, useLocations, useSaveLocation } from '../api/hooks.js';
import { HistoryDrawer, LinkedIdeas } from '../components/HistoryDrawer.js';
import { EmptyState, ErrorNote, Modal, Spinner, TextArea, TextInput } from '../components/ui.js';

export function LocationsPage() {
  const { projectId = '' } = useParams();
  const { data: locations, isLoading } = useLocations(projectId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!selectedId && locations?.length) setSelectedId(locations[0]!.id);
  }, [locations, selectedId]);

  const selected = locations?.find((l) => l.id === selectedId) ?? null;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">Locations</h2>
          <p className="mt-1 text-sm text-ink-500">
            Places and their rules. Sensory detail here is what stops scenes reading generic.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setCreating(true)}>
          New location
        </button>
      </div>

      {isLoading ? <Spinner /> : null}

      {locations && locations.length === 0 ? (
        <EmptyState
          title="No locations yet"
          body="Anywhere a scene could happen counts. A room is as valid as a country."
          action={
            <button className="btn-primary" onClick={() => setCreating(true)}>
              Add a location
            </button>
          }
        />
      ) : null}

      {locations && locations.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
          <ul className="space-y-1">
            {locations.map((location) => (
              <li key={location.id}>
                <button
                  onClick={() => setSelectedId(location.id)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                    selectedId === location.id ? 'bg-ink-800 text-white' : 'text-ink-700 hover:bg-ink-100'
                  }`}
                >
                  {location.name}
                </button>
              </li>
            ))}
          </ul>
          {selected ? <LocationEditor key={selected.id} projectId={projectId} location={selected} /> : null}
        </div>
      ) : null}

      <CreateModal open={creating} projectId={projectId} onClose={() => setCreating(false)} onCreated={setSelectedId} />
    </div>
  );
}

function CreateModal({
  open,
  projectId,
  onClose,
  onCreated,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const save = useSaveLocation(projectId);

  const submit = async () => {
    if (!name.trim()) return;
    const created = await save.mutateAsync({ name: name.trim(), description: description.trim() || null });
    onCreated(created.id);
    setName('');
    setDescription('');
    onClose();
  };

  return (
    <Modal open={open} title="New location" onClose={onClose}>
      <div className="space-y-4">
        <TextInput label="Name" value={name} onChange={setName} />
        <TextArea label="Description" value={description} onChange={setDescription} rows={3} />
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={!name.trim() || save.isPending}>
            Create
          </button>
        </div>
      </div>
    </Modal>
  );
}

function LocationEditor({ projectId, location }: { projectId: string; location: Location }) {
  const [draft, setDraft] = useState<Partial<Location>>(location);
  const [historyOpen, setHistoryOpen] = useState(false);
  const save = useSaveLocation(projectId);
  const remove = useDeleteLocation(projectId);
  const { data: ideas } = useEntityIdeas('location', location.id);

  useEffect(() => setDraft(location), [location]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(location);
  const set = (patch: Partial<Location>) => setDraft((prev) => ({ ...prev, ...patch }));

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-1 border-b border-ink-200 pb-2">
        <button className="btn-ghost text-xs" onClick={() => setHistoryOpen(true)}>
          History
        </button>
        <button
          className="btn-ghost text-xs text-red-500 hover:bg-red-50"
          onClick={() => {
            if (window.confirm(`Delete ${location.name}?`)) remove.mutate(location.id);
          }}
        >
          Delete
        </button>
      </div>

      <TextInput label="Name" value={draft.name ?? ''} onChange={(name) => set({ name })} />
      <TextArea label="Description" value={draft.description ?? ''} onChange={(v) => set({ description: v })} rows={3} />
      <TextArea
        label="Sensory detail"
        hint="Sound, smell, texture, light. What a character notices without looking."
        value={draft.sensoryDetails ?? ''}
        onChange={(v) => set({ sensoryDetails: v })}
        rows={3}
      />
      <TextArea
        label="Rules and lore"
        hint="What is true here that is not true elsewhere."
        value={draft.rulesLore ?? ''}
        onChange={(v) => set({ rulesLore: v })}
        rows={3}
      />

      <div className="flex items-center gap-3">
        <button
          className="btn-primary"
          disabled={!dirty || save.isPending}
          onClick={() =>
            save.mutate({
              id: location.id,
              name: draft.name,
              description: draft.description ?? null,
              sensoryDetails: draft.sensoryDetails ?? null,
              rulesLore: draft.rulesLore ?? null,
            })
          }
        >
          {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
        {dirty ? <span className="text-xs text-amber-600">Unsaved changes</span> : null}
        <ErrorNote error={save.error} />
      </div>

      <LinkedIdeas ideas={ideas} />

      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        projectId={projectId}
        entityType="location"
        entityId={location.id}
        title={location.name}
      />
    </div>
  );
}
