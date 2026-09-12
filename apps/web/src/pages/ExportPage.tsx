import { useState } from 'react';
import { useParams } from 'react-router';
import { useManuscript } from '../api/hooks.js';
import { EmptyState, Spinner } from '../components/ui.js';

export function ExportPage() {
  const { projectId = '' } = useParams();
  const { data: manuscript, isLoading } = useManuscript(projectId);
  const [format, setFormat] = useState<'md' | 'txt'>('md');
  const [includeTitles, setIncludeTitles] = useState(true);

  if (isLoading) return <Spinner />;

  const empty = manuscript && manuscript.chapters.length === 0 && !manuscript.draft;
  if (empty) {
    return <EmptyState title="Nothing to export" body="Write at least one chapter first." />;
  }

  const href = `/api/projects/${projectId}/export?format=${format}&includeTitles=${includeTitles}`;

  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-ink-900">Export</h2>
        <p className="mt-1 text-sm text-ink-500">
          Downloads the current version of every chapter, in order.
        </p>
      </div>

      <div className="card space-y-4 p-5">
        <div>
          <span className="label">Format</span>
          <div className="flex gap-2">
            <button className={format === 'md' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFormat('md')}>
              Markdown
            </button>
            <button className={format === 'txt' ? 'btn-primary' : 'btn-secondary'} onClick={() => setFormat('txt')}>
              Plain text
            </button>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input type="checkbox" checked={includeTitles} onChange={(e) => setIncludeTitles(e.target.checked)} />
          Include chapter headings
        </label>

        <div className="border-t border-ink-200 pt-4 text-sm text-ink-600">
          {manuscript?.chapters.length ?? 0} chapters · {(manuscript?.wordCount ?? 0).toLocaleString()} words
        </div>

        <a href={href} download className="btn-primary">
          Download
        </a>
      </div>
    </div>
  );
}
