import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import type { RunDetail, TaskHistoryRow } from '@cpwork/shared';
import { PageHeader } from '../components/ui/PageHeader';
import { TaskHistoryGrid } from '../components/task-workflow/TaskHistoryGrid';
import { api, getApiErrorMessage } from '../lib/api';
import type { ProjectListItem } from '../lib/projects';

export function TaskHistoryPage() {
  const navigate = useNavigate();
  const [projectFilter, setProjectFilter] = useState<string>('all');

  const projectsQ = useQuery({
    queryKey: ['projects'],
    queryFn: async () =>
      (await api.get<{ projects: ProjectListItem[] }>('/projects')).data.projects,
  });

  const projects = projectsQ.data ?? [];

  const historyQ = useQuery({
    queryKey: ['workflow-history-all', projects.map((p) => p.id)],
    queryFn: async () => {
      const results = await Promise.all(
        projects.map(async (project) => {
          const { data } = await api.get<{ rows: TaskHistoryRow[] }>(
            `/workflow/history?projectId=${project.id}`,
          );
          return (data.rows ?? []).map((row) => ({
            ...row,
            projectId: project.id,
            projectName: project.name,
          }));
        }),
      );
      return results
        .flat()
        .sort(
          (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
        );
    },
    enabled: projects.length > 0,
  });

  const rows = useMemo(() => {
    const all = historyQ.data ?? [];
    if (projectFilter === 'all') return all;
    return all.filter((row) => row.projectId === projectFilter);
  }, [historyQ.data, projectFilter]);

  function handleRestore(detail: RunDetail) {
    const { projectId, jiraKey } = detail.run;
    if (jiraKey) {
      navigate(`/workspaces/${projectId}/tasks/${encodeURIComponent(jiraKey)}`);
      return;
    }
    navigate(`/workspaces/${projectId}/tasks/_custom?type=custom`);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Task History" subtitle="Past workflow runs across workspaces" />

      {projectsQ.isLoading && <p className="text-sm text-slate-500">Loading workspaces…</p>}

      {projectsQ.isError && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {getApiErrorMessage(projectsQ.error)}
        </div>
      )}

      {!projectsQ.isLoading && projects.length === 0 && (
        <p className="text-sm text-slate-500">
          No workspaces available.{' '}
          <Link to="/workspaces" className="text-brand-600 hover:underline dark:text-brand-400">
            Open workspaces
          </Link>
        </p>
      )}

      {projects.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-slate-600 dark:text-slate-300">
              Workspace
              <select
                className="input ml-2 inline-block w-auto min-w-[12rem]"
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
              >
                <option value="all">All workspaces</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {historyQ.isFetching && (
              <span className="text-sm text-slate-400">Refreshing history…</span>
            )}
          </div>

          {historyQ.isError && (
            <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {getApiErrorMessage(historyQ.error)}
            </div>
          )}

          {historyQ.isLoading ? (
            <p className="text-sm text-slate-500">Loading workflow history…</p>
          ) : (
            <TaskHistoryGrid
              rows={rows}
              showProject={projectFilter === 'all'}
              emptyMessage="No workflow runs yet. Start a task from a workspace to see history here."
              onRestore={handleRestore}
            />
          )}
        </>
      )}
    </div>
  );
}
