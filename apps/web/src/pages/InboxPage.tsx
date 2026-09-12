import { useState } from 'react';
import { useParams } from 'react-router';
import type { Idea } from '@storytime/shared';
import {
  useCaptureIdea,
  useCharacters,
  useDeleteIdea,
  useIdeas,
  useLinkIdea,
  useLocations,
  usePlotLines,
  usePromoteIdea,
  useUnlinkIdea,
  useUpdateIdea,
} from '../api/hooks.js';
import { EmptyState, ErrorNote, Modal, Select, Spinner, TextInput, formatWhen } from '../components/ui.js';

type Filter = 'inbox' | 'triaged' | 'archived';

const ENTITY_LABELS: Record<string, string> = {
  character: 'Character',
  location: 'Location',
  plot_line: 'Plot line',
  plot_point: 'Plot point',
  story_parameters: 'Story parameters',
  chapter: 'Chapter',
  scene: 'Scene',
};

export function InboxPage() {
  const { projectId = '' } = useParams();
  const [filter, setFilter] = useState<Filter>('inbox');
  const [draft, setDraft] = useState('');
  const [filing, setFiling] = useState<Idea | null>(null);

  const { data: ideas, isLoading } = useIdeas(projectId, filter);
  const capture = useCaptureIdea(projectId);
  const updateIdea = useUpdateIdea(projectId);
  const deleteIdea = useDeleteIdea(projectId);
  const unlink = useUnlinkIdea(projectId);

  const submit = async () => {
    const text = draft.trim();
    if (!text) return;
    await capture.mutateAsync(text);
    setDraft('');
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink-900">Inbox</h2>
        <p className="mt-1 text-sm text-ink-500">
          Dump anything here without deciding where it goes. File it later, or never.
        </p>
      </div>

      <div className="card p-4">
        <textarea
          className="field resize-y"
          rows={3}
          placeholder="A half-formed idea, a line of dialogue, a question you have not answered yet…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter captures; Shift+Enter keeps writing.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-ink-400">Enter to capture, Shift+Enter for a new line.</span>
          <button className="btn-primary" onClick={submit} disabled={!draft.trim() || capture.isPending}>
            Capture
          </button>
        </div>
        <ErrorNote error={capture.error} />
      </div>

      <div className="flex gap-1">
        {(['inbox', 'triaged', 'archived'] as const).map((value) => (
          <button
            key={value}
            className={filter === value ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setFilter(value)}
          >
            {value === 'inbox' ? 'Unfiled' : value === 'triaged' ? 'Filed' : 'Archived'}
          </button>
        ))}
      </div>

      {isLoading ? <Spinner /> : null}

      {ideas && ideas.length === 0 ? (
        <EmptyState
          title={filter === 'inbox' ? 'Nothing waiting' : 'Nothing here'}
          body={
            filter === 'inbox'
              ? 'Captured ideas land here until you file them against a character, place, or plot point.'
              : 'Ideas you have filed or archived will show up here.'
          }
        />
      ) : null}

      <ul className="space-y-2">
        {ideas?.map((idea) => (
          <li key={idea.id} className="card p-4">
            <p className="text-sm whitespace-pre-wrap text-ink-800">{idea.text}</p>

            {idea.links.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {idea.links.map((link) => (
                  <span key={link.id} className="chip" title={link.note ?? undefined}>
                    <span className="text-ink-400">{ENTITY_LABELS[link.entityType] ?? link.entityType}:</span>
                    {link.entityLabel ?? 'unknown'}
                    <button
                      className="ml-0.5 text-ink-400 hover:text-red-600"
                      title="Remove this link"
                      onClick={() => unlink.mutate({ ideaId: idea.id, linkId: link.id })}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            ) : null}

            <div className="mt-3 flex items-center gap-2 text-xs">
              <span className="text-ink-400">{formatWhen(idea.createdAt)}</span>
              <div className="ml-auto flex gap-1">
                <button className="btn-secondary text-xs" onClick={() => setFiling(idea)}>
                  File to…
                </button>
                {idea.status !== 'archived' ? (
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => updateIdea.mutate({ id: idea.id, status: 'archived' })}
                  >
                    Archive
                  </button>
                ) : (
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => updateIdea.mutate({ id: idea.id, status: 'inbox' })}
                  >
                    Unarchive
                  </button>
                )}
                <button
                  className="btn-ghost text-xs text-red-500 hover:bg-red-50"
                  onClick={() => deleteIdea.mutate(idea.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <FileIdeaModal projectId={projectId} idea={filing} onClose={() => setFiling(null)} />
    </div>
  );
}

/**
 * Triage: attach an idea to something that already exists, or turn it into a new
 * entity in one step so capturing never stalls on "where does this go".
 */
function FileIdeaModal({
  projectId,
  idea,
  onClose,
}: {
  projectId: string;
  idea: Idea | null;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [entityType, setEntityType] = useState('character');
  const [entityId, setEntityId] = useState('');
  const [newName, setNewName] = useState('');
  const [plotLineId, setPlotLineId] = useState('');
  const [note, setNote] = useState('');

  const { data: characters } = useCharacters(projectId);
  const { data: locations } = useLocations(projectId);
  const { data: plotLines } = usePlotLines(projectId);

  const link = useLinkIdea(projectId);
  const promote = usePromoteIdea(projectId);

  const options = (() => {
    switch (entityType) {
      case 'character':
        return (characters ?? []).map((c) => ({ value: c.id, label: c.name }));
      case 'location':
        return (locations ?? []).map((l) => ({ value: l.id, label: l.name }));
      case 'plot_line':
        return (plotLines ?? []).map((l) => ({ value: l.id, label: l.name }));
      case 'plot_point':
        return (plotLines ?? []).flatMap((l) =>
          l.points.map((p) => ({ value: p.id, label: `${l.name} · ${p.title}` })),
        );
      default:
        return [];
    }
  })();

  const submit = async () => {
    if (!idea) return;
    if (mode === 'existing') {
      if (!entityId) return;
      await link.mutateAsync({ ideaId: idea.id, entityType, entityId, note: note.trim() || null });
    } else {
      if (!newName.trim()) return;
      await promote.mutateAsync({
        ideaId: idea.id,
        entityType,
        name: newName.trim(),
        ...(entityType === 'plot_point' ? { plotLineId } : {}),
      });
    }
    setEntityId('');
    setNewName('');
    setNote('');
    onClose();
  };

  const canCreateNew = ['character', 'location', 'plot_line', 'plot_point'].includes(entityType);
  const busy = link.isPending || promote.isPending;

  return (
    <Modal open={Boolean(idea)} title="File this idea" onClose={onClose}>
      {idea ? (
        <div className="space-y-4">
          <blockquote className="rounded-md border-l-2 border-ink-300 bg-ink-50 px-3 py-2 text-sm text-ink-600">
            {idea.text}
          </blockquote>

          <Select
            label="File as"
            value={entityType}
            onChange={(value) => {
              setEntityType(value);
              setEntityId('');
            }}
            options={[
              { value: 'character', label: 'Character' },
              { value: 'location', label: 'Location' },
              { value: 'plot_line', label: 'Plot line' },
              { value: 'plot_point', label: 'Plot point' },
              { value: 'story_parameters', label: 'Story parameters' },
            ]}
          />

          {canCreateNew ? (
            <div className="flex gap-1">
              <button className={mode === 'existing' ? 'btn-primary' : 'btn-secondary'} onClick={() => setMode('existing')}>
                Attach to existing
              </button>
              <button className={mode === 'new' ? 'btn-primary' : 'btn-secondary'} onClick={() => setMode('new')}>
                Create new from this
              </button>
            </div>
          ) : null}

          {mode === 'existing' || !canCreateNew ? (
            options.length > 0 ? (
              <Select
                label="Which one"
                value={entityId}
                onChange={setEntityId}
                options={[{ value: '', label: 'Choose…' }, ...options]}
              />
            ) : (
              <p className="text-sm text-ink-500">
                There are no {ENTITY_LABELS[entityType]?.toLowerCase() ?? 'entities'} yet. Create one from this idea
                instead.
              </p>
            )
          ) : (
            <>
              <TextInput
                label="Name"
                value={newName}
                onChange={setNewName}
                placeholder={entityType === 'plot_point' ? 'What happens' : 'Name'}
              />
              {entityType === 'plot_point' ? (
                <Select
                  label="On which plot line"
                  value={plotLineId}
                  onChange={setPlotLineId}
                  options={[
                    { value: '', label: 'Choose…' },
                    ...(plotLines ?? []).map((l) => ({ value: l.id, label: l.name })),
                  ]}
                />
              ) : null}
              <p className="text-xs text-ink-400">
                The idea text becomes the description, and the two stay linked so you can see where it came from.
              </p>
            </>
          )}

          {mode === 'existing' ? (
            <TextInput label="Note" hint="Optional. How this idea applies." value={note} onChange={setNote} />
          ) : null}

          <ErrorNote error={link.error ?? promote.error} />

          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" onClick={submit} disabled={busy}>
              {busy ? 'Filing…' : 'File it'}
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
