import { Link, useParams } from 'react-router';
import { useProjectGraph, useRuns } from '../api/hooks.js';
import { Spinner, StaleBadge, formatWhen } from '../components/ui.js';

export function OverviewPage() {
  const { projectId = '' } = useParams();
  const { data: graph } = useProjectGraph(projectId);
  const { data: runs } = useRuns(projectId);

  if (!graph) return <Spinner />;

  const staleChapters = graph.chapters.filter((c) => c.staleLevel !== 'none');
  const unwritten = graph.chapters.filter((c) => !c.currentVersionId);
  const lastRun = runs?.[0];
  const target = graph.storyParameters.targetLengthWords;
  const progress = target ? Math.min(100, Math.round((graph.counts.words / target) * 100)) : null;

  const stats = [
    { label: 'Characters', value: graph.counts.characters, to: 'characters' },
    { label: 'Locations', value: graph.counts.locations, to: 'locations' },
    { label: 'Plot points', value: graph.counts.plotPoints, to: 'plot' },
    { label: 'Unfiled ideas', value: graph.counts.ideasInbox, to: 'inbox' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink-900">{graph.project.title}</h2>
          {graph.project.description ? (
            <p className="mt-1 max-w-2xl text-sm text-ink-500">{graph.project.description}</p>
          ) : null}
        </div>
        <Link to={`/p/${projectId}/generate`} className="btn-primary ml-auto">
          Generate
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {stats.map((stat) => (
          <Link key={stat.label} to={`/p/${projectId}/${stat.to}`} className="card p-4 hover:border-ink-300">
            <div className="text-2xl font-semibold text-ink-900">{stat.value}</div>
            <div className="mt-0.5 text-xs text-ink-500">{stat.label}</div>
          </Link>
        ))}
      </div>

      <div className="card p-5">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-ink-800">Progress</h3>
          <span className="text-sm text-ink-600">
            {graph.counts.words.toLocaleString()}
            {target ? ` of ${target.toLocaleString()}` : ''} words
          </span>
        </div>
        {progress !== null ? (
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-100">
            <div className="h-full rounded-full bg-lamp-500" style={{ width: `${progress}%` }} />
          </div>
        ) : (
          <p className="mt-1 text-xs text-ink-400">Set a target length in Parameters to track progress.</p>
        )}
        <p className="mt-2 text-xs text-ink-500">
          {graph.counts.chapters} chapters, {unwritten.length} still unwritten
          {graph.counts.scenes > 0 ? `, ${graph.counts.scenes} scenes` : ''}.
        </p>
      </div>

      {staleChapters.length > 0 ? (
        <div className="card p-5">
          <h3 className="mb-2 text-sm font-semibold text-ink-800">
            Out of date since the bible changed
          </h3>
          <ul className="space-y-2">
            {staleChapters.map((chapter) => (
              <li key={chapter.id} className="flex items-center gap-2 text-sm">
                <Link to={`/p/${projectId}/manuscript`} className="text-ink-800 hover:text-ink-600">
                  {chapter.title}
                </Link>
                <StaleBadge level={chapter.staleLevel} reasons={chapter.staleReasons} />
              </li>
            ))}
          </ul>
          <Link to={`/p/${projectId}/generate`} className="btn-secondary mt-3 text-xs">
            Rewrite what needs it
          </Link>
        </div>
      ) : null}

      {lastRun ? (
        <div className="card p-5">
          <h3 className="mb-1 text-sm font-semibold text-ink-800">Last run</h3>
          <p className="text-sm text-ink-600">
            <Link to={`/p/${projectId}/runs/${lastRun.id}`} className="hover:text-ink-900">
              {lastRun.kind} · {lastRun.mode}
            </Link>{' '}
            — {lastRun.status} · {formatWhen(lastRun.createdAt)}
          </p>
          {lastRun.error ? <p className="mt-1 text-xs text-red-600">{lastRun.error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
