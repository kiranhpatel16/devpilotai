import type { JiraIssueDetail } from '@cpwork/shared';

function statusColor(category: string): string {
  switch (category) {
    case 'Done':
      return 'bg-green-100 text-green-700';
    case 'In Progress':
      return 'bg-blue-100 text-blue-700';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

export function SelectedJiraTaskCard({
  issue,
  loading,
  error,
  productionBranch,
}: {
  issue: JiraIssueDetail | undefined;
  loading?: boolean;
  error?: string | null;
  productionBranch: string;
}) {
  if (loading) {
    return <p className="text-sm text-slate-400">Loading task details…</p>;
  }

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }

  if (!issue) return null;

  const meta = [
    `Branch from ${productionBranch}`,
    issue.issueType,
    issue.priority,
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            <span className="font-mono text-brand-700">{issue.key}</span> · {issue.summary}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">{meta.join(' · ')}</p>
        </div>
        {issue.url && (
          <a
            href={issue.url}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary shrink-0 text-xs"
          >
            Open in Jira ↗
          </a>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {issue.issueType && <span className="badge bg-slate-100 text-slate-600">{issue.issueType}</span>}
        {issue.priority && <span className="badge bg-slate-100 text-slate-600">{issue.priority}</span>}
        {issue.assignee && <span className="badge bg-slate-100 text-slate-600">{issue.assignee}</span>}
        <span className={`badge ${statusColor(issue.statusCategory)}`}>{issue.status}</span>
        {issue.labels.map((label) => (
          <span key={label} className="badge bg-blue-100 text-blue-700">
            {label}
          </span>
        ))}
      </div>

      <div>
        <label className="label text-xs uppercase tracking-wide text-slate-500">Jira description</label>
        <div className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-slate-700 whitespace-pre-wrap">
          {issue.description?.trim() || '(no description)'}
        </div>
      </div>
    </div>
  );
}
