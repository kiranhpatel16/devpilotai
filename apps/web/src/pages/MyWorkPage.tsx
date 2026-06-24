import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { ProjectListItem } from '../lib/projects';

export function MyWorkPage() {
  const projectsQ = useQuery({
    queryKey: ['projects'],
    queryFn: async () =>
      (await api.get<{ projects: ProjectListItem[] }>('/projects')).data.projects,
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">My Work</h1>
        <p className="text-sm text-slate-500">
          Select a project to open the Agent Port and work on Jira tasks.
        </p>
      </div>

      {projectsQ.isLoading && <p className="text-sm text-slate-400">Loading projects…</p>}

      {projectsQ.data?.length === 0 && (
        <div className="card p-6 text-center text-sm text-slate-500">
          No projects assigned to you yet. Ask an administrator to assign you a project.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(projectsQ.data ?? []).map((p) => (
          <div key={p.id} className="card flex flex-col p-4">
            <div className="flex items-start justify-between">
              <h2 className="font-medium">{p.name}</h2>
              {p.myRole && (
                <span className="badge bg-brand-50 text-brand-700">{p.myRole}</span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Jira: {p.jira.projectKey ?? '—'}
            </p>

            <div className="mt-3">
              {!p.hasEnvironment ? (
                <span className="badge bg-amber-100 text-amber-700">
                  Local environment not configured
                </span>
              ) : p.environmentVerified ? (
                <span className="badge bg-green-100 text-green-700">Environment verified</span>
              ) : (
                <span className="badge bg-slate-100 text-slate-600">Environment unverified</span>
              )}
            </div>

            <div className="mt-4 flex gap-2">
              <Link to={`/workspaces/${p.id}`} className="btn-primary flex-1">
                Open
              </Link>
              <Link to="/settings/environments" className="btn-secondary">
                Setup
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
