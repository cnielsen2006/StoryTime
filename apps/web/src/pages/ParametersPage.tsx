import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import type { StoryParameters } from '@storytime/shared';
import {
  useModels,
  useProjectGraph,
  useProviders,
  useUpdateProject,
  useUpdateStoryParameters,
} from '../api/hooks.js';
import { ErrorNote, Select, Spinner, TextArea, TextInput } from '../components/ui.js';

export function ParametersPage() {
  const { projectId = '' } = useParams();
  const { data: graph, isLoading } = useProjectGraph(projectId);
  const saveParams = useUpdateStoryParameters(projectId);
  const saveProject = useUpdateProject(projectId);
  const { data: providers } = useProviders();

  const [draft, setDraft] = useState<Partial<StoryParameters>>({});
  const [comps, setComps] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('');
  const [tokenBudget, setTokenBudget] = useState('');

  useEffect(() => {
    if (!graph) return;
    setDraft(graph.storyParameters);
    setComps(graph.storyParameters.comparableTitles.join(', '));
    setProvider(graph.project.provider ?? '');
    setModel(graph.project.model ?? '');
    setEffort(graph.project.effort ?? '');
    setTokenBudget(graph.project.tokenBudget ? String(graph.project.tokenBudget) : '');
  }, [graph]);

  const { data: models } = useModels(provider || undefined);

  if (isLoading || !graph) return <Spinner />;

  const set = (patch: Partial<StoryParameters>) => setDraft((prev) => ({ ...prev, ...patch }));

  const submitParameters = () =>
    saveParams.mutate({
      audience: draft.audience ?? null,
      genre: draft.genre ?? null,
      tone: draft.tone ?? null,
      pov: draft.pov ?? null,
      tense: draft.tense ?? null,
      styleNotes: draft.styleNotes ?? null,
      contentGuidelines: draft.contentGuidelines ?? null,
      targetLengthWords: draft.targetLengthWords ?? null,
      comparableTitles: comps
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    } as never);

  const submitProject = () =>
    saveProject.mutate({
      provider: (provider || null) as never,
      model: model || null,
      effort: (effort || null) as never,
      tokenBudget: tokenBudget ? Number(tokenBudget) : null,
    });

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-ink-900">Story parameters</h2>
        <p className="mt-1 text-sm text-ink-500">
          These shape every prompt. Changing them marks everything already written as needing a rewrite.
        </p>
      </div>

      <section className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            label="Intended audience"
            value={draft.audience ?? ''}
            onChange={(audience) => set({ audience })}
            placeholder="Young adult, 14 and up"
          />
          <TextInput label="Genre" value={draft.genre ?? ''} onChange={(genre) => set({ genre })} />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <TextInput
            label="Point of view"
            value={draft.pov ?? ''}
            onChange={(pov) => set({ pov })}
            placeholder="First person, Isolde"
          />
          <TextInput label="Tense" value={draft.tense ?? ''} onChange={(tense) => set({ tense })} placeholder="Past" />
          <div>
            <label className="label">Target length (words)</label>
            <input
              className="field"
              type="number"
              min={100}
              step={1000}
              value={draft.targetLengthWords ?? ''}
              onChange={(e) => set({ targetLengthWords: e.target.value ? Number(e.target.value) : null })}
            />
          </div>
        </div>

        <TextInput label="Tone" value={draft.tone ?? ''} onChange={(tone) => set({ tone })} />
        <TextArea
          label="Style notes"
          hint="Sentence rhythm, paragraph length, habits to avoid."
          value={draft.styleNotes ?? ''}
          onChange={(styleNotes) => set({ styleNotes })}
          rows={4}
        />
        <TextArea
          label="Content guidelines"
          hint="Hard limits. These override everything else in the prompt."
          value={draft.contentGuidelines ?? ''}
          onChange={(contentGuidelines) => set({ contentGuidelines })}
          rows={3}
        />
        <TextInput
          label="Comparable titles"
          hint="Comma separated."
          value={comps}
          onChange={setComps}
          placeholder="The Scorpio Races, A Monster Calls"
        />

        <ErrorNote error={saveParams.error} />
        <button className="btn-primary" onClick={submitParameters} disabled={saveParams.isPending}>
          {saveParams.isPending ? 'Saving…' : 'Save parameters'}
        </button>
      </section>

      <section className="space-y-4 border-t border-ink-200 pt-8">
        <div>
          <h3 className="text-base font-semibold text-ink-900">Model for this book</h3>
          <p className="mt-1 text-sm text-ink-500">Leave blank to use the global defaults from Settings.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Provider"
            value={provider}
            onChange={(value) => {
              setProvider(value);
              setModel('');
            }}
            options={[
              { value: '', label: 'Use global default' },
              ...(providers ?? []).map((p) => ({
                value: p.id,
                label: p.configured ? p.label : `${p.label} (not configured)`,
              })),
            ]}
          />
          {models && models.length > 0 ? (
            <Select
              label="Model"
              value={model}
              onChange={setModel}
              options={[{ value: '', label: 'Use default' }, ...models.map((m) => ({ value: m.id, label: m.displayName }))]}
            />
          ) : (
            <TextInput label="Model" value={model} onChange={setModel} placeholder="Use default" />
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Effort"
            hint="How hard the model works. Higher costs more and takes longer."
            value={effort}
            onChange={setEffort}
            options={[
              { value: '', label: 'Use global default' },
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
              { value: 'xhigh', label: 'Very high' },
              { value: 'max', label: 'Maximum' },
            ]}
          />
          <div>
            <label className="label">Prompt token budget</label>
            <input
              className="field"
              type="number"
              min={1000}
              step={1000}
              value={tokenBudget}
              placeholder="Automatic"
              onChange={(e) => setTokenBudget(e.target.value)}
            />
            <p className="mt-1 text-xs text-ink-400">
              How much of the story bible may go into one prompt. Lower it for small local models.
            </p>
          </div>
        </div>

        <ErrorNote error={saveProject.error} />
        <button className="btn-primary" onClick={submitProject} disabled={saveProject.isPending}>
          {saveProject.isPending ? 'Saving…' : 'Save model settings'}
        </button>
      </section>
    </div>
  );
}
