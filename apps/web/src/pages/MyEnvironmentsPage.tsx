import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ProjectListItem } from '../lib/projects';
import {
  JiraIdentityCard,
  ProjectEnvironmentEditor,
} from '../components/workspace/ProjectEnvironmentSettings';

export function MyEnvironmentsPage() {
  const projectsQ = useQuery({
    queryKey: ['projects'],
    queryFn: async () =>
      (await api.get<{ projects: ProjectListItem[] }>('/projects')).data.projects,
  });

  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">My Environments</h1>
        <p className="text-sm text-slate-500">
          Each project can live at a different local path on your machine. Configure yours
          here, or use the Settings tab inside any workspace.
        </p>
      </div>

      <JiraIdentityCard />

      {projectsQ.data?.length === 0 && (
        <div className="card p-6 text-center text-sm text-slate-500">
          No projects assigned to you yet.
        </div>
      )}

      <div className="space-y-3">
        {(projectsQ.data ?? []).map((p) => (
          <div key={p.id} className="card">
            <button
              type="button"
              className="flex w-full items-center justify-between px-4 py-3 text-left"
              onClick={() => setOpenId(openId === p.id ? null : p.id)}
            >
              <span className="font-medium">{p.name}</span>
              <span className="flex items-center gap-2">
                {p.environmentVerified ? (
                  <span className="badge bg-green-100 text-green-700">verified</span>
                ) : p.hasEnvironment ? (
                  <span className="badge bg-slate-100 text-slate-600">unverified</span>
                ) : (
                  <span className="badge bg-amber-100 text-amber-700">not set</span>
                )}
                <span className="text-slate-400">{openId === p.id ? '▲' : '▼'}</span>
              </span>
            </button>
            {openId === p.id && (
              <div className="border-t border-slate-200 px-4 py-4 dark:border-neutral-800">
                <ProjectEnvironmentEditor
                  projectId={p.id}
                  projectName={p.name}
                  showHeader={false}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
