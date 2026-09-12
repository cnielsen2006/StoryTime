import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { SeedAudience, SeedSize, StoryCategoryId } from '@storytime/shared';
import { useIdeateOptions, useIdeateProject, useProviders } from '../api/hooks.js';
import { ErrorNote, Modal, Select, Spinner, TextArea } from './ui.js';

/**
 * Invent a whole project from a genre.
 *
 * The result is a normal project: the same tables, the same change history, and
 * ready to generate chapters from straight away. Everything it produces is a
 * starting point the author is expected to overwrite.
 */
export function IdeateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const { data: options, isLoading } = useIdeateOptions();
  const { data: providers } = useProviders();
  const ideate = useIdeateProject();

  const [category, setCategory] = useState<StoryCategoryId>('surprise');
  const [audience, setAudience] = useState<SeedAudience>('any');
  const [size, setSize] = useState<SeedSize>('medium');
  const [premise, setPremise] = useState('');
  const [showPremise, setShowPremise] = useState(false);

  const usingMock = providers?.find((p) => p.id === 'mock');
  const anyRealProvider = providers?.some((p) => p.id !== 'mock' && p.configured);

  const submit = async () => {
    const result = await ideate.mutateAsync({
      category,
      audience,
      size,
      premise: premise.trim() || null,
    });
    onClose();
    navigate(`/p/${result.projectId}/overview`);
  };

  const close = () => {
    if (ideate.isPending) return;
    onClose();
  };

  return (
    <Modal open={open} title="Invent a book" onClose={close}>
      {isLoading || !options ? (
        <Spinner />
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-ink-500">
            Pick a genre and the model will invent a premise, a cast with histories, places, and a plot skeleton. It
            becomes an ordinary project you can edit, so treat all of it as a first draft.
          </p>

          <div>
            <span className="label">Genre</span>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {options.categories.map((option) => (
                <button
                  key={option.id}
                  title={option.hint}
                  onClick={() => setCategory(option.id as StoryCategoryId)}
                  className={`rounded-md border px-2.5 py-2 text-left text-sm transition-colors ${
                    category === option.id
                      ? 'border-ink-700 bg-ink-800 text-white'
                      : 'border-ink-200 bg-white text-ink-700 hover:border-ink-300 hover:bg-ink-50'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink-400">
              {options.categories.find((c) => c.id === category)?.hint}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Audience"
              value={audience}
              onChange={(value) => setAudience(value as SeedAudience)}
              options={options.audiences.map((a) => ({ value: a.id, label: a.label }))}
            />
            <Select
              label="How much to invent"
              hint={options.sizes.find((s) => s.id === size)?.detail}
              value={size}
              onChange={(value) => setSize(value as SeedSize)}
              options={options.sizes.map((s) => ({ value: s.id, label: s.label }))}
            />
          </div>

          {showPremise ? (
            <TextArea
              label="Starting point"
              hint="Optional. A setting, an image, a first line. The model builds on it rather than replacing it."
              value={premise}
              onChange={setPremise}
              rows={3}
              placeholder="A town where nobody has dreamed in forty years."
            />
          ) : (
            <button className="btn-ghost text-xs" onClick={() => setShowPremise(true)}>
              Add a starting point of your own
            </button>
          )}

          {!anyRealProvider && usingMock ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              No API key is configured, so this will use the mock provider and produce placeholder content. Add a key in
              Settings for a real story.
            </p>
          ) : null}

          <ErrorNote error={ideate.error} />

          {ideate.isPending ? (
            <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-3">
              <Spinner label="Inventing the story. This takes up to a minute." />
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={close} disabled={ideate.isPending}>
              Cancel
            </button>
            <button className="btn-primary" onClick={submit} disabled={ideate.isPending}>
              {ideate.isPending ? 'Inventing…' : 'Invent it'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
