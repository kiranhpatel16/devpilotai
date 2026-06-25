import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { RunDetail, TaskHistoryPage } from '@cpwork/shared';
import { STATUS_OPTIONS, TaskHistoryGrid } from '../task-workflow/TaskHistoryGrid';
import { api, getApiErrorMessage } from '../../lib/api';
import { customTaskPath } from '../../lib/customTaskRoutes';

const DEFAULT_PAGE_SIZE = 20;

interface WorkspaceTaskHistoryPanelProps {
  projectId: string;
}

export function WorkspaceTaskHistoryPanel({ projectId }: WorkspaceTaskHistoryPanelProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [searchInput, setSearchInput] = useState(searchParams.get('q') ?? '');

  const userFilter = searchParams.get('userId') ?? 'all';
  const statusFilter = searchParams.get('status') ?? '';
  const search = searchParams.get('q') ?? '';
  const page = Math.max(Number(searchParams.get('page') ?? '1'), 1);
  const pageSize = Number(searchParams.get('pageSize') ?? String(DEFAULT_PAGE_SIZE));

  const historyQ = useQuery({
    queryKey: ['workflow-history', projectId, userFilter, statusFilter, search, page, pageSize],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('projectId', projectId);
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      if (userFilter !== 'all') params.set('userId', userFilter);
      if (statusFilter) params.set('status', statusFilter);
      if (search.trim()) params.set('q', search.trim());
      return (await api.get<TaskHistoryPage>(`/workflow/history?${params.toString()}`)).data;
    },
    enabled: !!projectId,
  });

  const bulkDeleteM = useMutation({
    mutationFn: async (runIds: string[]) =>
      (await api.post<{ deleted: number }>('/workflow/runs/bulk-delete', { runIds })).data,
    onSuccess: () => {
      setSelectedIds([]);
      queryClient.invalidateQueries({ queryKey: ['workflow-history', projectId] });
    },
  });

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  function updateParams(updates: Record<string, string | null>, resetPage = true) {
    const next = new URLSearchParams(searchParams);
    next.set('tab', 'history');
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    if (resetPage) next.set('page', '1');
    setSearchParams(next, { replace: true });
  }

  function handleRestore(detail: RunDetail) {
    const { projectId: restoredProjectId, jiraKey } = detail.run;
    const state = { restoredDetail: detail };
    if (jiraKey) {
      navigate(`/workspaces/${restoredProjectId}/tasks/${encodeURIComponent(jiraKey)}`, {
        state,
      });
      return;
    }
    navigate(customTaskPath(restoredProjectId, detail.run.id), { state });
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    updateParams({ q: searchInput.trim() || null });
  }

  function handleBulkDelete() {
    if (selectedIds.length === 0) return;
    if (
      !window.confirm(
        `Delete ${selectedIds.length} selected workflow record(s)? This cannot be undone.`,
      )
    ) {
      return;
    }
    bulkDeleteM.mutate(selectedIds);
  }

  const history = historyQ.data;
  const rows = history?.rows ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Task history</h2>
        <p className="text-sm text-slate-500">
          Past workflow runs for this workspace. Restore a run to continue where you left off.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm text-slate-600 dark:text-slate-300">
          User
          <select
            className="input ml-2 mt-1 block min-w-[12rem]"
            value={userFilter}
            onChange={(e) => updateParams({ userId: e.target.value === 'all' ? null : e.target.value })}
          >
            <option value="all">All users</option>
            {(history?.filterUsers ?? []).map((user) => (
              <option key={user.userId} value={user.userId}>
                {user.displayName || user.username}
              </option>
            ))}
          </select>
        </label>

        <label className="text-sm text-slate-600 dark:text-slate-300">
          Status
          <select
            className="input ml-2 mt-1 block min-w-[12rem]"
            value={statusFilter}
            onChange={(e) => updateParams({ status: e.target.value || null })}
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value || 'all'} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <form onSubmit={handleSearchSubmit} className="min-w-[14rem] flex-1">
          <label className="text-sm text-slate-600 dark:text-slate-300">
            Search
            <div className="mt-1 flex gap-2">
              <input
                className="input flex-1"
                placeholder="Task key, branch, summary…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              <button type="submit" className="btn-secondary px-3">
                Apply
              </button>
            </div>
          </label>
        </form>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {selectedIds.length > 0 && (
          <button
            type="button"
            className="btn-danger"
            disabled={bulkDeleteM.isPending}
            onClick={handleBulkDelete}
          >
            Delete selected ({selectedIds.length})
          </button>
        )}
        {historyQ.isFetching && (
          <span className="text-sm text-slate-400">Refreshing history…</span>
        )}
      </div>

      {historyQ.isError && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {getApiErrorMessage(historyQ.error)}
        </div>
      )}

      {bulkDeleteM.isError && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {getApiErrorMessage(bulkDeleteM.error)}
        </div>
      )}

      {historyQ.isLoading ? (
        <p className="text-sm text-slate-500">Loading workflow history…</p>
      ) : (
        <TaskHistoryGrid
          rows={rows}
          showUser
          allowDelete
          selectedIds={selectedIds}
          onSelectionChange={setSelectedIds}
          onDeleted={() => queryClient.invalidateQueries({ queryKey: ['workflow-history', projectId] })}
          emptyMessage={
            history?.total
              ? 'No workflow runs match your filters.'
              : 'No workflow runs yet. Start a task from the Tasks tab to see history here.'
          }
          onRestore={handleRestore}
          pagination={
            history
              ? {
                  page: history.page,
                  pageSize: history.pageSize,
                  total: history.total,
                  onPageChange: (nextPage) => updateParams({ page: String(nextPage) }, false),
                  onPageSizeChange: (nextSize) =>
                    updateParams({ pageSize: String(nextSize), page: '1' }),
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
