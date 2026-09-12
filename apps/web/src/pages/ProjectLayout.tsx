import { NavLink, Outlet, useParams, Link } from 'react-router';
import { useProjectGraph } from '../api/hooks.js';
import { ErrorNote, Spinner } from '../components/ui.js';

const NAV = [
  { to: 'overview', label: 'Overview' },
  { to: 'inbox', label: 'Inbox' },
  { to: 'characters', label: 'Characters' },
  { to: 'locations', label: 'Locations' },
  { to: 'plot', label: 'Plot' },
  { to: 'parameters', label: 'Parameters' },
  { to: 'manuscript', label: 'Manuscript' },
  { to: 'generate', label: 'Generate' },
  { to: 'runs', label: 'Runs' },
  { to: 'export', label: 'Export' },
];

export function ProjectLayout() {
  const { projectId = '' } = useParams();
  const { data: graph, isLoading, error } = useProjectGraph(projectId);

  const counts: Record<string, number> = {
    inbox: graph?.counts.ideasInbox ?? 0,
    characters: graph?.counts.characters ?? 0,
    locations: graph?.counts.locations ?? 0,
    plot: graph?.counts.plotPoints ?? 0,
    manuscript: graph?.counts.chapters ?? 0,
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3">
          <Link to="/" className="text-sm text-ink-400 hover:text-ink-700">
            ← Books
          </Link>
          <h1 className="truncate text-base font-semibold text-ink-900">{graph?.project.title ?? 'Loading…'}</h1>
          {graph ? (
            <span className="chip">
              {graph.project.provider ?? 'default provider'}
              {graph.project.model ? ` · ${graph.project.model}` : ''}
            </span>
          ) : null}
          {graph && graph.counts.staleTargets > 0 ? (
            <Link to={`/p/${projectId}/manuscript`} className="chip border-amber-200 bg-amber-50 text-amber-700">
              {graph.counts.staleTargets} out of date
            </Link>
          ) : null}
          <span className="ml-auto text-xs text-ink-400">
            {(graph?.counts.words ?? 0).toLocaleString()} words written
          </span>
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl gap-8 px-6 py-8">
        <nav className="w-44 shrink-0">
          <ul className="space-y-0.5">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    `flex items-center justify-between rounded-md px-3 py-1.5 text-sm ${
                      isActive ? 'bg-ink-800 text-white' : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
                    }`
                  }
                >
                  {item.label}
                  {counts[item.to] ? <span className="text-xs opacity-60">{counts[item.to]}</span> : null}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 flex-1">
          <ErrorNote error={error} />
          {isLoading ? <Spinner label="Loading the story bible" /> : <Outlet />}
        </main>
      </div>
    </div>
  );
}
