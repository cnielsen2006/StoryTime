import { Link, useParams } from 'react-router';
import { useRuns } from '../api/hooks.js';
import { EmptyState, Spinner, formatWhen } from '../components/ui.js';

const STATUS_STYLES: Record<string, string> = {
  succeeded: 'text-emerald-700',
  failed: 'text-red-600',
  cancelled: 'text-ink-500',
  running: 'text-sky-700',
  queued: 'text-sky-700',
};

export function RunsPage() {
  const { projectId = '' } = useParams();
  const { data: runs, isLoading } = useRuns(projectId);

  if (isLoading) return <Spinner />;

  if (runs?.length === 0) {
    return (
      <EmptyState
        title="No runs yet"
        body="Every generation is recorded here with the prompt it used and what it cost."
        action={
          <Link to={`/p/${projectId}/generate`} className="btn-primary">
            Generate something
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-ink-900">Runs</h2>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-ink-50 text-left text-xs text-ink-500">
            <tr>
              <th className="px-4 py-2 font-medium">What</th>
              <th className="px-4 py-2 font-medium">Model</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 text-right font-medium">Tokens out</th>
              <th className="px-4 py-2 text-right font-medium">When</th>
            </tr>
          </thead>
          <tbody>
            {runs?.map((run) => (
              <tr key={run.id} className="border-t border-ink-200 hover:bg-ink-50">
                <td className="px-4 py-2">
                  <Link to={`/p/${projectId}/runs/${run.id}`} className="text-ink-800 hover:text-ink-600">
                    {run.kind} · {run.mode}
                  </Link>
                  {run.instructions ? (
                    <div className="mt-0.5 max-w-md truncate text-xs text-ink-400">{run.instructions}</div>
                  ) : null}
                </td>
                <td className="px-4 py-2 text-ink-600">
                  {run.provider}
                  <span className="text-ink-400"> · {run.model}</span>
                </td>
                <td className={`px-4 py-2 ${STATUS_STYLES[run.status] ?? 'text-ink-600'}`}>
                  {run.status}
                  {run.error ? <div className="max-w-xs truncate text-xs text-red-500">{run.error}</div> : null}
                </td>
                <td className="px-4 py-2 text-right text-ink-600">
                  {run.outputTokens ? run.outputTokens.toLocaleString() : '—'}
                </td>
                <td className="px-4 py-2 text-right text-xs text-ink-400">{formatWhen(run.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
