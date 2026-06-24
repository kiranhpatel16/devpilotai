import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/ui/PageHeader';
import { api } from '../lib/api';
import type { ProjectListItem } from '../lib/projects';

export function TasksPage() {
  const projectsQ = useQuery({
    queryKey: ['projects'],
    queryFn: async () =>
      (await api.get<{ projects: ProjectListItem[] }>('/projects')).data.projects,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Jira Tasks"
        subtitle="Select a workspace to view and work on Jira tasks"
      />

      <div className="grid gap-3">
        {(projectsQ.data ?? []).map((p) => (
          <Link
            key={p.id}
            to={`/workspaces/${p.id}`}
            className="card flex items-center justify-between border-surface-700 bg-surface-800/80 p-4 hover:border-brand-500/50"
          >
            <div>
              <p className="font-medium text-white">{p.name}</p>
              <p className="text-xs text-slate-500">Jira: {p.jira.projectKey ?? '—'}</p>
            </div>
            <span className="text-brand-400">Open →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
