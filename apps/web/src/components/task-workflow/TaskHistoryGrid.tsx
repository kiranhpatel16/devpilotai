import { useMutation } from '@tanstack/react-query';
import type { RunDetail, TaskHistoryRow } from '@cpwork/shared';
import { api } from '../../lib/api';

export function TaskHistoryGrid({
  rows,
  onRestore,
  showProject = false,
  emptyMessage = 'No workflow runs yet for this project.',
}: {
  rows: TaskHistoryRow[];
  onRestore: (detail: RunDetail) => void;
  showProject?: boolean;
  emptyMessage?: string;
}) {
  const safeRows = Array.isArray(rows) ? rows : [];

  const restoreM = useMutation({
    mutationFn: async (runId: string) =>
      (await api.post<{ detail: RunDetail }>(`/workflow/runs/${runId}/restore`)).data.detail,
    onSuccess: (detail) => onRestore(detail),
  });

  if (safeRows.length === 0) {
    return (
      <div className="card p-6 text-center text-sm text-slate-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-slate-700 dark:bg-slate-900">
          <tr>
            {showProject && <th className="px-3 py-2">Workspace</th>}
            <th className="px-3 py-2">Task</th>
            <th className="px-3 py-2">Branch</th>
            <th className="px-3 py-2">Provider</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2">Tests</th>
            <th className="px-3 py-2">Updated</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {safeRows.map((row) => (
            <tr key={row.runId} className="border-b border-slate-100 dark:border-slate-800">
              {showProject && (
                <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
                  {'projectName' in row && typeof row.projectName === 'string'
                    ? row.projectName
                    : '—'}
                </td>
              )}
              <td className="px-3 py-2 font-mono text-brand-700">{row.jiraKey || '—'}</td>
              <td className="px-3 py-2 font-mono text-xs">{row.branchName || '—'}</td>
              <td className="px-3 py-2 text-xs">{row.provider || '—'}</td>
              <td className="px-3 py-2">
                <span className="badge bg-slate-100 text-slate-600">{row.approvalStatus}</span>
              </td>
              <td className="px-3 py-2 text-xs">{row.testPassRate || '—'}</td>
              <td className="px-3 py-2 text-xs text-slate-400">
                {new Date(row.updatedAt).toLocaleString()}
              </td>
              <td className="px-3 py-2">
                <button
                  className="text-xs font-medium text-brand-600 hover:underline"
                  disabled={restoreM.isPending}
                  onClick={() => restoreM.mutate(row.runId)}
                >
                  Restore
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
