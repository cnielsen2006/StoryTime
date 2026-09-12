import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import type { CharacterDetail, CharacterExperience, CharacterExperienceInput } from '@storytime/shared';
import {
  useCharacters,
  useDeleteCharacter,
  useDeleteRelationship,
  useEntityIdeas,
  useRelationships,
  useSaveCharacter,
  useSaveRelationship,
} from '../api/hooks.js';
import { HistoryDrawer, LinkedIdeas } from '../components/HistoryDrawer.js';
import { EmptyState, ErrorNote, Modal, Select, Spinner, TextArea, TextInput } from '../components/ui.js';

/**
 * Form state. Experiences are omitted from the read model before being re-added
 * as partials, so an in-progress row without a title is representable.
 */
type Draft = Omit<Partial<CharacterDetail>, 'experiences'> & {
  experiences?: Array<Partial<CharacterExperience>>;
};

const ROLE_OPTIONS = [
  { value: 'protagonist', label: 'Protagonist' },
  { value: 'antagonist', label: 'Antagonist' },
  { value: 'supporting', label: 'Supporting' },
  { value: 'minor', label: 'Minor' },
];

export function CharactersPage() {
  const { projectId = '' } = useParams();
  const { data: characters, isLoading } = useCharacters(projectId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const selected = characters?.find((c) => c.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId && characters?.length) setSelectedId(characters[0]!.id);
  }, [characters, selectedId]);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">Characters</h2>
          <p className="mt-1 text-sm text-ink-500">
            Descriptions and the experiences that shaped them. All of it goes into every prompt.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setCreating(true)}>
          New character
        </button>
      </div>

      {isLoading ? <Spinner /> : null}

      {characters && characters.length === 0 ? (
        <EmptyState
          title="No characters yet"
          body="A name and a sentence is enough to start. Backstory and experiences can accumulate over time."
          action={
            <button className="btn-primary" onClick={() => setCreating(true)}>
              Add a character
            </button>
          }
        />
      ) : null}

      {characters && characters.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
          <ul className="space-y-1">
            {characters.map((character) => (
              <li key={character.id}>
                <button
                  onClick={() => setSelectedId(character.id)}
                  className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                    selectedId === character.id ? 'bg-ink-800 text-white' : 'text-ink-700 hover:bg-ink-100'
                  }`}
                >
                  <div className="font-medium">{character.name}</div>
                  <div className={`text-xs ${selectedId === character.id ? 'text-white/60' : 'text-ink-400'}`}>
                    {character.role}
                  </div>
                </button>
              </li>
            ))}
          </ul>

          {selected ? <CharacterEditor key={selected.id} projectId={projectId} character={selected} /> : null}
        </div>
      ) : null}

      <CharacterCreateModal open={creating} projectId={projectId} onClose={() => setCreating(false)} onCreated={setSelectedId} />
    </div>
  );
}

function CharacterCreateModal({
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
  const [role, setRole] = useState('supporting');
  const [description, setDescription] = useState('');
  const save = useSaveCharacter(projectId);

  const submit = async () => {
    if (!name.trim()) return;
    const created = await save.mutateAsync({ name: name.trim(), role: role as never, description: description.trim() || null });
    onCreated(created.id);
    setName('');
    setDescription('');
    onClose();
  };

  return (
    <Modal open={open} title="New character" onClose={onClose}>
      <div className="space-y-4">
        <TextInput label="Name" value={name} onChange={setName} />
        <Select label="Role" value={role} onChange={setRole} options={ROLE_OPTIONS} />
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

function CharacterEditor({ projectId, character }: { projectId: string; character: CharacterDetail }) {
  const [draft, setDraft] = useState<Draft>(character);
  const [tab, setTab] = useState<'profile' | 'experiences' | 'relationships'>('profile');
  const [historyOpen, setHistoryOpen] = useState(false);

  const save = useSaveCharacter(projectId);
  const remove = useDeleteCharacter(projectId);
  const { data: ideas } = useEntityIdeas('character', character.id);

  // Reset the form when a different character is selected.
  useEffect(() => setDraft(character), [character]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(character);
  const set = (patch: Draft) => setDraft((prev) => ({ ...prev, ...patch }));

  const submit = async () => {
    await save.mutateAsync({
      id: character.id,
      name: draft.name,
      role: draft.role,
      description: draft.description ?? null,
      appearance: draft.appearance ?? null,
      personality: draft.personality ?? null,
      backstory: draft.backstory ?? null,
      arcNotes: draft.arcNotes ?? null,
      experiences: draft.experiences as CharacterExperienceInput[],
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 border-b border-ink-200 pb-2">
        {(['profile', 'experiences', 'relationships'] as const).map((value) => (
          <button
            key={value}
            className={tab === value ? 'btn-primary text-xs' : 'btn-ghost text-xs'}
            onClick={() => setTab(value)}
          >
            {value === 'profile' ? 'Profile' : value === 'experiences' ? `Experiences (${draft.experiences?.length ?? 0})` : 'Relationships'}
          </button>
        ))}
        <div className="ml-auto flex gap-1">
          <button className="btn-ghost text-xs" onClick={() => setHistoryOpen(true)}>
            History
          </button>
          <button
            className="btn-ghost text-xs text-red-500 hover:bg-red-50"
            onClick={() => {
              if (window.confirm(`Delete ${character.name}?`)) remove.mutate(character.id);
            }}
          >
            Delete
          </button>
        </div>
      </div>

      {tab === 'profile' ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput label="Name" value={draft.name ?? ''} onChange={(name) => set({ name })} />
            <Select label="Role" value={draft.role ?? 'supporting'} onChange={(role) => set({ role: role as never })} options={ROLE_OPTIONS} />
          </div>
          <TextArea label="Description" value={draft.description ?? ''} onChange={(v) => set({ description: v })} rows={3} />
          <TextArea label="Appearance" value={draft.appearance ?? ''} onChange={(v) => set({ appearance: v })} rows={2} />
          <TextArea label="Personality" value={draft.personality ?? ''} onChange={(v) => set({ personality: v })} rows={3} />
          <TextArea label="Backstory" value={draft.backstory ?? ''} onChange={(v) => set({ backstory: v })} rows={4} />
          <TextArea
            label="Arc notes"
            hint="Where this character starts and where they end up."
            value={draft.arcNotes ?? ''}
            onChange={(v) => set({ arcNotes: v })}
            rows={3}
          />
        </div>
      ) : null}

      {tab === 'experiences' ? (
        <ExperienceEditor
          experiences={draft.experiences ?? []}
          onChange={(experiences) => set({ experiences })}
        />
      ) : null}

      {tab === 'relationships' ? <RelationshipEditor projectId={projectId} characterId={character.id} /> : null}

      {tab !== 'relationships' ? (
        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={submit} disabled={!dirty || save.isPending}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
          {dirty ? <span className="text-xs text-amber-600">Unsaved changes</span> : null}
          <ErrorNote error={save.error} />
        </div>
      ) : null}

      <LinkedIdeas ideas={ideas} />

      <HistoryDrawer
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        projectId={projectId}
        entityType="character"
        entityId={character.id}
        title={character.name}
      />
    </div>
  );
}

/** Ordered life events. Order carries meaning, so moving is first-class. */
function ExperienceEditor({
  experiences,
  onChange,
}: {
  experiences: Array<Partial<CharacterExperience>>;
  onChange: (next: Array<Partial<CharacterExperience>>) => void;
}) {
  const move = (index: number, delta: number) => {
    const next = [...experiences];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };

  const update = (index: number, patch: Partial<CharacterExperience>) => {
    onChange(experiences.map((exp, i) => (i === index ? { ...exp, ...patch } : exp)));
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-500">
        Events that made this character who they are, oldest first. These reach the model in order.
      </p>

      {experiences.map((experience, index) => (
        <div key={experience.id ?? index} className="card space-y-3 p-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-ink-400">#{index + 1}</span>
            <div className="ml-auto flex gap-1">
              <button className="btn-ghost text-xs" onClick={() => move(index, -1)} disabled={index === 0}>
                ↑
              </button>
              <button
                className="btn-ghost text-xs"
                onClick={() => move(index, 1)}
                disabled={index === experiences.length - 1}
              >
                ↓
              </button>
              <button
                className="btn-ghost text-xs text-red-500 hover:bg-red-50"
                onClick={() => onChange(experiences.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-[10rem_1fr]">
            <TextInput
              label="When"
              value={experience.whenLabel ?? ''}
              onChange={(whenLabel) => update(index, { whenLabel })}
              placeholder="Age nine"
            />
            <TextInput
              label="What happened"
              value={experience.title ?? ''}
              onChange={(title) => update(index, { title })}
            />
          </div>
          <TextArea
            label="Detail"
            value={experience.description ?? ''}
            onChange={(description) => update(index, { description })}
            rows={2}
          />
          <TextInput
            label="What it left them with"
            value={experience.impact ?? ''}
            onChange={(impact) => update(index, { impact })}
            placeholder="A refusal to go near the water at night"
          />
        </div>
      ))}

      <button className="btn-secondary" onClick={() => onChange([...experiences, { title: '' }])}>
        Add an experience
      </button>
    </div>
  );
}

function RelationshipEditor({ projectId, characterId }: { projectId: string; characterId: string }) {
  const { data: characters } = useCharacters(projectId);
  const { data: relationships } = useRelationships(projectId);
  const save = useSaveRelationship(projectId);
  const remove = useDeleteRelationship(projectId);

  const [toCharacterId, setToCharacterId] = useState('');
  const [kind, setKind] = useState('');
  const [description, setDescription] = useState('');

  const names = new Map((characters ?? []).map((c) => [c.id, c.name]));
  const mine = (relationships ?? []).filter(
    (r) => r.fromCharacterId === characterId || r.toCharacterId === characterId,
  );

  const submit = async () => {
    if (!toCharacterId || !kind.trim()) return;
    await save.mutateAsync({ fromCharacterId: characterId, toCharacterId, kind: kind.trim(), description: description.trim() || null });
    setToCharacterId('');
    setKind('');
    setDescription('');
  };

  return (
    <div className="space-y-4">
      {mine.length === 0 ? (
        <p className="text-sm text-ink-500">No relationships yet.</p>
      ) : (
        <ul className="space-y-2">
          {mine.map((relationship) => (
            <li key={relationship.id} className="card flex items-start gap-3 p-3 text-sm">
              <div>
                <div className="text-ink-800">
                  {names.get(relationship.fromCharacterId)} → {names.get(relationship.toCharacterId)}:{' '}
                  <span className="font-medium">{relationship.kind}</span>
                </div>
                {relationship.description ? (
                  <p className="mt-0.5 text-xs text-ink-500">{relationship.description}</p>
                ) : null}
              </div>
              <button
                className="btn-ghost ml-auto text-xs text-red-500 hover:bg-red-50"
                onClick={() => remove.mutate(relationship.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="card space-y-3 p-4">
        <h4 className="text-xs font-semibold tracking-wide text-ink-500 uppercase">Add a relationship</h4>
        <Select
          label="With"
          value={toCharacterId}
          onChange={setToCharacterId}
          options={[
            { value: '', label: 'Choose…' },
            ...(characters ?? []).filter((c) => c.id !== characterId).map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
        <TextInput label="Relationship" value={kind} onChange={setKind} placeholder="reluctant ally" />
        <TextArea label="Detail" value={description} onChange={setDescription} rows={2} />
        <ErrorNote error={save.error} />
        <button className="btn-primary" onClick={submit} disabled={!toCharacterId || !kind.trim()}>
          Add
        </button>
      </div>
    </div>
  );
}
