import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { getLastWorkspaceId } from '../lib/lastWorkspace';

/** Redirect /workspaces → last used or first project task board. */
export function WorkspacesRedirectPage() {
  const projectsQ = useQuery({
    queryKey: ['projects'],
    queryFn: async () =>
      (await api.get<{ projects: { id: string }[] }>('/projects')).data.projects,
  });

  if (projectsQ.isLoading) {
    return <p className="text-sm text-slate-500">Loading workspace…</p>;
  }

  const projects = projectsQ.data ?? [];
  if (projects.length === 0) {
    return <Navigate to="/workspaces/empty" replace />;
  }

  const lastId = getLastWorkspaceId();
  const target =
    lastId && projects.some((p) => p.id === lastId) ? lastId : projects[0].id;

  return <Navigate to={`/workspaces/${target}`} replace />;
}
