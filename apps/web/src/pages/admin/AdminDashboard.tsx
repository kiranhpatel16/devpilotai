import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Activity, Project, PublicUser } from '@cpwork/shared';
import { api } from '../../lib/api';

interface UserRow extends PublicUser {
  projectRoles: { projectId: string; projectName: string; role: string }[];
}

export function AdminDashboard() {
  const usersQ = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async () => (await api.get<{ users: UserRow[] }>('/admin/users')).data.users,
  });
  const projectsQ = useQuery({
    queryKey: ['admin', 'projects'],
    queryFn: async () =>
      (await api.get<{ projects: (Project & { userCount: number })[] }>('/admin/projects'))
        .data.projects,
  });
  const activityQ = useQuery({
    queryKey: ['admin', 'activities', 5],
    queryFn: async () =>
      (await api.get<{ activities: Activity[] }>('/admin/activities?limit=5')).data
        .activities,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Admin Dashboard</h1>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Users" value={usersQ.data?.length ?? '—'} to="/admin/users" />
        <StatCard
          label="Projects"
          value={projectsQ.data?.length ?? '—'}
          to="/admin/projects"
        />
        <StatCard label="Recent activity" value={activityQ.data?.length ?? '—'} />
      </div>

      <section className="card">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="font-medium">Users</h2>
          <Link to="/admin/users" className="text-sm text-brand-600 hover:underline">
            Manage →
          </Link>
        </header>
        <div className="divide-y divide-slate-100">
          {(usersQ.data ?? []).slice(0, 5).map((u) => (
            <div key={u.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="font-medium">{u.displayName}</span>
              <span className="text-slate-500">{u.username}</span>
              <span className="badge bg-slate-100 text-slate-600">{u.globalRole}</span>
              <span className="text-slate-400">{u.projectRoles.length} projects</span>
            </div>
          ))}
          {usersQ.data?.length === 0 && (
            <p className="px-4 py-3 text-sm text-slate-400">No users yet.</p>
          )}
        </div>
      </section>

      <section className="card">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="font-medium">Projects</h2>
          <Link to="/admin/projects" className="text-sm text-brand-600 hover:underline">
            Manage →
          </Link>
        </header>
        <div className="divide-y divide-slate-100">
          {(projectsQ.data ?? []).map((p) => (
            <div key={p.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <span className="font-medium">{p.name}</span>
              <span className="text-slate-500">{p.jira.projectKey ?? '—'}</span>
              <span className="text-slate-400">{p.userCount} users</span>
            </div>
          ))}
          {projectsQ.data?.length === 0 && (
            <p className="px-4 py-3 text-sm text-slate-400">No projects yet.</p>
          )}
        </div>
      </section>

      <section className="card">
        <header className="border-b border-slate-200 px-4 py-3">
          <h2 className="font-medium">Last 5 user activities</h2>
        </header>
        <div className="divide-y divide-slate-100">
          {(activityQ.data ?? []).map((a) => (
            <div key={a.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="w-32 shrink-0 text-slate-400">
                {new Date(a.createdAt).toLocaleString()}
              </span>
              <span className="font-medium">{a.username ?? 'system'}</span>
              <span className="text-slate-600">{a.summary}</span>
            </div>
          ))}
          {activityQ.data?.length === 0 && (
            <p className="px-4 py-3 text-sm text-slate-400">No activity recorded yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  to,
}: {
  label: string;
  value: number | string;
  to?: string;
}) {
  const inner = (
    <div className="card p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}
