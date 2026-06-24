import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader';
import { TaskHistoryGrid } from '../components/task-workflow/TaskHistoryGrid';
import { api } from '../lib/api';
import type { ProjectListItem } from '../lib/projects';
import type { TaskHistoryRow } from '@cpwork/shared';

export function TaskHistoryPage() {
  const projectsQ = useQuery({
    queryKey: ['projects'],
    queryFn: async () =>
      (await api.get<{ projects: ProjectListItem[] }>('/projects')).data.projects,
  });

  const firstProject = projectsQ.data?.[0]?.id;

  const historyQ = useQuery({
    queryKey: ['workflow-history-all', firstProject],
    queryFn: async () =>
      firstProject
        ? (await api.get<{ rows: TaskHistoryRow[] }>(`/workflow/history?projectId=${firstProject}`))
            .data.rows
        : [],
    enabled: !!firstProject,
  });

  return (
    <div className="space-y-6">
      <PageHeader title="Task History" subtitle="Past workflow runs across workspaces" />

      {firstProject ? (
        <TaskHistoryGrid rows={historyQ.data ?? []} onRestore={() => {}} />
      ) : (
        <p className="text-sm text-slate-500">
          No workspaces available.{' '}
          <Link to="/workspaces" className="text-brand-400 hover:underline">
            Open workspaces
          </Link>
        </p>
      )}
    </div>
  );
}
