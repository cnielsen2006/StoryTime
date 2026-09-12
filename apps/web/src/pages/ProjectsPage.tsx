import { useState } from 'react';
import { Link } from 'react-router';
import { useCreateProject, useDeleteProject, useProjects } from '../api/hooks.js';
import { EmptyState, ErrorNote, Modal, Spinner, TextArea, TextInput, formatCount } from '../components/ui.js';

export function ProjectsPage() {
  const { data: projects, isLoading, error } = useProjects();
  const createProject = useCreateProject();
  const deleteProject = useDeleteProject();

  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const submit = async () => {
    if (!title.trim()) return;
    await createProject.mutateAsync({ title: title.trim(), description: description.trim() || null });
    setTitle('');
    setDescription('');
    setCreating(false);
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">StoryTime</h1>
          <p className="mt-1 text-sm text-ink-500">
            Collect loose ideas, shape them into a story bible, and let it write the book.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/settings" className="btn-secondary">
            Settings
          </Link>
          <button className="btn-primary" onClick={() => setCreating(true)}>
            New book
          </button>
        </div>
      </header>

      <ErrorNote error={error} />
      {isLoading ? <Spinner label="Loading your books" /> : null}

      {projects && projects.length === 0 ? (
        <EmptyState
          title="No books yet"
          body="A book starts as a title and nothing else. Add characters, places, and half-formed plot points as they occur to you, then generate when there is enough to work with."
          action={
            <button className="btn-primary" onClick={() => setCreating(true)}>
              Start your first book
            </button>
          }
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {projects?.map((project) => (
          <div key={project.id} className="card flex flex-col gap-3 p-5">
            <div>
              <Link to={`/p/${project.id}`} className="text-lg font-semibold text-ink-900 hover:text-ink-600">
                {project.title}
              </Link>
              {project.description ? (
                <p className="mt-1 line-clamp-3 text-sm text-ink-500">{project.description}</p>
              ) : null}
            </div>

            <div className="mt-auto flex items-center gap-3 text-xs text-ink-500">
              <span>{formatCount(project.wordCount, 'word')}</span>
              {project.staleCount > 0 ? (
                <span className="text-amber-700">{formatCount(project.staleCount, 'chapter')} out of date</span>
              ) : null}
              <span className="ml-auto">
                <button
                  className="btn-ghost text-xs text-red-500 hover:bg-red-50"
                  onClick={() => {
                    if (window.confirm(`Delete "${project.title}" and everything in it? This cannot be undone.`)) {
                      deleteProject.mutate(project.id);
                    }
                  }}
                >
                  Delete
                </button>
              </span>
            </div>
          </div>
        ))}
      </div>

      <Modal open={creating} title="New book" onClose={() => setCreating(false)}>
        <div className="space-y-4">
          <TextInput label="Title" value={title} onChange={setTitle} placeholder="The Lantern Keeper" />
          <TextArea
            label="One-line premise"
            hint="Optional. A sentence you can change later."
            value={description}
            onChange={setDescription}
            rows={3}
          />
          <ErrorNote error={createProject.error} />
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setCreating(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={submit} disabled={!title.trim() || createProject.isPending}>
              {createProject.isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
