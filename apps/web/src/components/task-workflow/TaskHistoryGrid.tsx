import { useMutation } from '@tanstack/react-query';
import type { RunDetail, TaskHistoryRow } from '@cpwork/shared';
import { api } from '../../lib/api';

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'plan_pending', label: 'Plan pending' },
  { value: 'plan_approved', label: 'Plan approved' },
  { value: 'code_pending', label: 'Code pending' },
  { value: 'code_approved', label: 'Code approved' },
  { value: 'done', label: 'Done' },
  { value: 'failed', label: 'Failed' },
] as const;

export { STATUS_OPTIONS };

export function TaskHistoryGrid({
  rows,
  onRestore,
  showProject = false,
  showUser = false,
  allowDelete = false,
  selectedIds = [],
  onSelectionChange,
  onDeleted,
  emptyMessage = 'No workflow runs yet for this project.',
  pagination,
}: {
  rows: TaskHistoryRow[];
  onRestore: (detail: RunDetail) => void;
  showProject?: boolean;
  showUser?: boolean;
  allowDelete?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  onDeleted?: () => void;
  emptyMessage?: string;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
  };
}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const selectable = allowDelete && !!onSelectionChange;
  const allSelected =
    safeRows.length > 0 && safeRows.every((row) => selectedIds.includes(row.runId));

  const restoreM = useMutation({
    mutationFn: async (runId: string) =>
      (await api.post<{ detail: RunDetail }>(`/workflow/runs/${runId}/restore`)).data.detail,
    onSuccess: (detail) => onRestore(detail),
  });

  const deleteM = useMutation({
    mutationFn: async (runId: string) => {
      await api.delete(`/workflow/runs/${runId}`);
    },
    onSuccess: () => onDeleted?.(),
  });

  function toggleAll() {
    if (!onSelectionChange) return;
    if (allSelected) {
      const pageIds = new Set(safeRows.map((row) => row.runId));
      onSelectionChange(selectedIds.filter((id) => !pageIds.has(id)));
      return;
    }
    const merged = new Set([...selectedIds, ...safeRows.map((row) => row.runId)]);
    onSelectionChange([...merged]);
  }

  function toggleOne(runId: string) {
    if (!onSelectionChange) return;
    if (selectedIds.includes(runId)) {
      onSelectionChange(selectedIds.filter((id) => id !== runId));
      return;
    }
    onSelectionChange([...selectedIds, runId]);
  }

  function userLabel(row: TaskHistoryRow) {
    return row.displayName || row.username || '—';
  }

  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;

  if (safeRows.length === 0) {
    return (
      <div className="space-y-3">
        <div className="card p-6 text-center text-sm text-slate-500">
          {emptyMessage}
        </div>
        {pagination && pagination.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
            <p>
              Showing 0 of {pagination.total}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary px-3 py-1"
                disabled={pagination.page <= 1}
                onClick={() => pagination.onPageChange(pagination.page - 1)}
              >
                Previous
              </button>
              <span className="tabular-nums">
                Page {pagination.page} of {totalPages}
              </span>
              <button
                type="button"
                className="btn-secondary px-3 py-1"
                disabled={pagination.page >= totalPages}
                onClick={() => pagination.onPageChange(pagination.page + 1)}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="card overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase text-slate-500 dark:border-neutral-800 dark:bg-black">
            <tr>
              {selectable && (
                <th className="px-3 py-2">
                  <input
                    type="checkbox"
                    className="rounded border-slate-300"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all rows on this page"
                  />
                </th>
              )}
              {showProject && <th className="px-3 py-2">Workspace</th>}
              {showUser && <th className="px-3 py-2">User</th>}
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
              <tr key={row.runId} className="border-b border-slate-100 dark:border-neutral-800">
                {selectable && (
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      className="rounded border-slate-300"
                      checked={selectedIds.includes(row.runId)}
                      onChange={() => toggleOne(row.runId)}
                      aria-label={`Select ${row.jiraKey || row.runId}`}
                    />
                  </td>
                )}
                {showProject && (
                  <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
                    {row.projectName || '—'}
                  </td>
                )}
                {showUser && (
                  <td className="px-3 py-2 text-xs text-slate-600 dark:text-slate-300">
                    {userLabel(row)}
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
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      className="text-xs font-medium text-brand-600 hover:underline"
                      disabled={restoreM.isPending}
                      onClick={() => restoreM.mutate(row.runId)}
                    >
                      Restore
                    </button>
                    {allowDelete && (
                      <button
                        type="button"
                        className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                        disabled={deleteM.isPending}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete workflow history for ${row.jiraKey || row.runId}? This cannot be undone.`,
                            )
                          ) {
                            deleteM.mutate(row.runId);
                          }
                        }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pagination && (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
          <p>
            Showing{' '}
            {pagination.total === 0
              ? 0
              : (pagination.page - 1) * pagination.pageSize + 1}
            –
            {Math.min(pagination.page * pagination.pageSize, pagination.total)} of{' '}
            {pagination.total}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2">
              Per page
              <select
                className="input w-auto py-1"
                value={pagination.pageSize}
                onChange={(e) => pagination.onPageSizeChange(Number(e.target.value))}
              >
                {[10, 20, 50].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-secondary px-3 py-1"
                disabled={pagination.page <= 1}
                onClick={() => pagination.onPageChange(pagination.page - 1)}
              >
                Previous
              </button>
              <span className="tabular-nums">
                Page {pagination.page} of {totalPages}
              </span>
              <button
                type="button"
                className="btn-secondary px-3 py-1"
                disabled={pagination.page >= totalPages}
                onClick={() => pagination.onPageChange(pagination.page + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
