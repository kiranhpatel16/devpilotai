import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  GLOBAL_ROLES,
  PROJECT_ROLES,
  type GlobalRole,
  type Project,
  type ProjectRole,
  type PublicUser,
} from '@cpwork/shared';
import { api, getApiErrorMessage } from '../../lib/api';
import { ConfirmDeleteModal } from '../../components/ConfirmDeleteModal';

interface UserRow extends PublicUser {
  projectRoles: { projectId: string; projectName: string; role: ProjectRole }[];
}

export function AdminUsersPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [rolesUser, setRolesUser] = useState<UserRow | null>(null);
  const [deleting, setDeleting] = useState<UserRow | null>(null);

  const usersQ = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: async () => (await api.get<{ users: UserRow[] }>('/admin/users')).data.users,
  });
  const projectsQ = useQuery({
    queryKey: ['admin', 'projects'],
    queryFn: async () =>
      (await api.get<{ projects: Project[] }>('/admin/projects')).data.projects,
  });

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['admin', 'users'] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Users</h1>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          + Add User
        </button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Username</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Projects</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(usersQ.data ?? []).map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-2 font-medium">{u.displayName}</td>
                <td className="px-4 py-2 text-slate-500">{u.username}</td>
                <td className="px-4 py-2 text-slate-500">{u.email || '—'}</td>
                <td className="px-4 py-2">
                  <span className="badge bg-slate-100 text-slate-600">{u.globalRole}</span>
                </td>
                <td className="px-4 py-2 text-slate-500">
                  {u.projectRoles.map((r) => `${r.projectName} (${r.role})`).join(', ') ||
                    '—'}
                </td>
                <td className="px-4 py-2">
                  <StatusBadge status={u.status} />
                </td>
                <td className="px-4 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <button className="btn-ghost" onClick={() => setEditingUser(u)}>
                      Edit
                    </button>
                    <button className="btn-ghost" onClick={() => setRolesUser(u)}>
                      Roles
                    </button>
                    <button className="btn-danger" onClick={() => setDeleting(u)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {usersQ.isLoading && <p className="p-4 text-sm text-slate-400">Loading…</p>}
      </div>

      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            invalidate();
          }}
        />
      )}

      {editingUser && (
        <EditUserModal
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onSaved={() => {
            setEditingUser(null);
            invalidate();
          }}
        />
      )}

      {rolesUser && (
        <ProjectRolesModal
          user={rolesUser}
          projects={projectsQ.data ?? []}
          onClose={() => setRolesUser(null)}
          onSaved={() => {
            setRolesUser(null);
            invalidate();
          }}
        />
      )}

      {deleting && (
        <ConfirmDeleteModal
          title={`Delete user "${deleting.displayName}"?`}
          message="This permanently removes the user account, project roles, environments, and run history. This cannot be undone."
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.delete(`/admin/users/${deleting.id}`);
            setDeleting(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'active'
      ? 'bg-green-100 text-green-700'
      : status === 'locked'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-slate-200 text-slate-600';
  return <span className={`badge ${cls}`}>{status}</span>;
}

function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md">
        <div className="card">
          <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="font-medium">{title}</h2>
            <button className="btn-ghost" onClick={onClose}>
              ✕
            </button>
          </header>
          <div className="p-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

function CreateUserModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    username: '',
    displayName: '',
    email: '',
    password: '',
    globalRole: 'developer' as GlobalRole,
  });
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () =>
      api.post('/admin/users', {
        username: form.username,
        displayName: form.displayName,
        email: form.email || undefined,
        password: form.password,
        globalRole: form.globalRole,
      }),
    onSuccess: onCreated,
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  return (
    <Modal title="Add User" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="label">Username</label>
          <input
            className="input"
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Display name</label>
          <input
            className="input"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Email (optional)</label>
          <input
            className="input"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Temporary password (min 10 chars)</label>
          <input
            className="input"
            type="text"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Global role</label>
          <select
            className="input"
            value={form.globalRole}
            onChange={(e) =>
              setForm({ ...form, globalRole: e.target.value as GlobalRole })
            }
          >
            {GLOBAL_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        {error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function EditUserModal({
  user,
  onClose,
  onSaved,
}: {
  user: UserRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    displayName: user.displayName,
    email: user.email ?? '',
    globalRole: user.globalRole,
    status: user.status,
    newPassword: '',
    mustChangePassword: true,
  });
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      await api.put(`/admin/users/${user.id}`, {
        displayName: form.displayName,
        email: form.email || null,
        globalRole: form.globalRole,
        status: form.status,
      });
      if (form.newPassword.trim()) {
        await api.post(`/admin/users/${user.id}/reset-password`, {
          newPassword: form.newPassword,
          mustChange: form.mustChangePassword,
        });
      }
    },
    onSuccess: onSaved,
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  return (
    <Modal title={`Edit user — ${user.username}`} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="label">Username</label>
          <input className="input bg-slate-50 text-slate-500" value={user.username} readOnly />
        </div>
        <div>
          <label className="label">Display name</label>
          <input
            className="input"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Email</label>
          <input
            className="input"
            type="email"
            placeholder="user@company.com"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Global role</label>
          <select
            className="input"
            value={form.globalRole}
            onChange={(e) =>
              setForm({ ...form, globalRole: e.target.value as GlobalRole })
            }
          >
            {GLOBAL_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select
            className="input"
            value={form.status}
            onChange={(e) =>
              setForm({
                ...form,
                status: e.target.value as 'active' | 'disabled' | 'locked',
              })
            }
          >
            <option value="active">active</option>
            <option value="disabled">disabled</option>
            <option value="locked">locked</option>
          </select>
        </div>
        <div className="border-t border-slate-200 pt-3">
          <label className="label">New password</label>
          <input
            className="input"
            type="password"
            placeholder="Leave blank to keep current password"
            value={form.newPassword}
            onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
          />
          <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={form.mustChangePassword}
              onChange={(e) =>
                setForm({ ...form, mustChangePassword: e.target.checked })
              }
              disabled={!form.newPassword.trim()}
            />
            Require password change on next login
          </label>
        </div>
        {error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={mutation.isPending || !form.displayName.trim()}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ProjectRolesModal({
  user,
  projects,
  onClose,
  onSaved,
}: {
  user: UserRow;
  projects: Project[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [assignments, setAssignments] = useState<Record<string, ProjectRole | ''>>(() => {
    const initial: Record<string, ProjectRole | ''> = {};
    for (const r of user.projectRoles) initial[r.projectId] = r.role;
    return initial;
  });
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () =>
      api.put(`/admin/users/${user.id}/project-roles`, {
        assignments: Object.entries(assignments)
          .filter(([, role]) => role)
          .map(([projectId, role]) => ({ projectId, role })),
      }),
    onSuccess: onSaved,
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  return (
    <Modal title={`Project roles — ${user.displayName}`} onClose={onClose}>
      <div className="space-y-3">
        {projects.length === 0 && (
          <p className="text-sm text-slate-400">No projects exist yet.</p>
        )}
        {projects.map((p) => (
          <div key={p.id} className="flex items-center justify-between gap-3">
            <span className="text-sm">{p.name}</span>
            <select
              className="input max-w-[160px]"
              value={assignments[p.id] ?? ''}
              onChange={(e) =>
                setAssignments({
                  ...assignments,
                  [p.id]: e.target.value as ProjectRole | '',
                })
              }
            >
              <option value="">— none —</option>
              {PROJECT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        ))}
        {error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
