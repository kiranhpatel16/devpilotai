import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Project } from '@cpwork/shared';
import { api } from '../../lib/api';
import { ConfirmDeleteModal } from '../../components/ConfirmDeleteModal';
import {
  ProjectSettingsForm,
  type ProjectWithMeta,
} from '../../components/workspace/ProjectSettingsForm';

type ProjectWithCount = Project & {
  userCount: number;
  hasJiraToken: boolean;
  hasGitToken?: boolean;
  hasCustomAiRules?: boolean;
};

export function AdminProjectsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ProjectWithMeta | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ProjectWithCount | null>(null);
  const [aiRulesNotice, setAiRulesNotice] = useState<{ projectId: string; name: string } | null>(
    null,
  );

  const projectsQ = useQuery({
    queryKey: ['admin', 'projects'],
    queryFn: async () =>
      (await api.get<{ projects: ProjectWithMeta[] }>('/admin/projects')).data.projects,
  });

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['admin', 'projects'] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Projects</h1>
        <button className="btn-primary" onClick={() => setCreating(true)}>
          + Add Project
        </button>
      </div>

      {aiRulesNotice && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Project <strong>{aiRulesNotice.name}</strong> saved. It is using{' '}
          <strong>system default AI rules</strong>.{' '}
          <Link
            to={`/settings/ai-rules?project=${aiRulesNotice.projectId}`}
            className="font-medium text-brand-700 underline"
          >
            Add custom AI rules
          </Link>{' '}
          for implementation quality, Magento conventions, and agent output — or keep defaults.
          <button
            type="button"
            className="ml-3 text-amber-700 underline"
            onClick={() => setAiRulesNotice(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Slug</th>
              <th className="px-4 py-2">Default path</th>
              <th className="px-4 py-2">Jira</th>
              <th className="px-4 py-2">AI rules</th>
              <th className="px-4 py-2">Users</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
            {(projectsQ.data ?? []).map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2 font-medium">{p.name}</td>
                <td className="px-4 py-2 text-slate-500">{p.slug}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-500">
                  {p.defaults.projectRoot || '—'}
                </td>
                <td className="px-4 py-2 text-slate-500">{p.jira.projectKey ?? '—'}</td>
                <td className="px-4 py-2">
                  {p.hasCustomAiRules ? (
                    <Link
                      to={`/settings/ai-rules?project=${p.id}`}
                      className="text-green-700 hover:underline"
                    >
                      Custom
                    </Link>
                  ) : (
                    <Link
                      to={`/settings/ai-rules?project=${p.id}`}
                      className="text-slate-400 hover:underline"
                    >
                      Defaults
                    </Link>
                  )}
                </td>
                <td className="px-4 py-2 text-slate-400">{p.userCount}</td>
                <td className="px-4 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <button className="btn-ghost" onClick={() => setEditing(p)}>
                      Edit
                    </button>
                    <button className="btn-danger" onClick={() => setDeleting(p)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {projectsQ.isLoading && <p className="p-4 text-sm text-slate-400">Loading…</p>}
        {projectsQ.data?.length === 0 && (
          <p className="p-4 text-sm text-slate-400">No projects yet. Add one to start.</p>
        )}
      </div>

      {(creating || editing) && (
        <ProjectModal
          project={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={(saved) => {
            setCreating(false);
            setEditing(null);
            invalidate();
            if (saved && !saved.hasCustomAiRules) {
              setAiRulesNotice({ projectId: saved.id, name: saved.name });
            }
          }}
        />
      )}

      {deleting && (
        <ConfirmDeleteModal
          title={`Delete project "${deleting.name}"?`}
          message="This removes the project and all user assignments, environments, and runs linked to it. This cannot be undone."
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.delete(`/admin/projects/${deleting.id}`);
            setDeleting(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function ProjectModal({
  project,
  onClose,
  onSaved,
}: {
  project: ProjectWithMeta | null;
  onClose: () => void;
  onSaved: (project?: ProjectWithCount) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl">
        <div className="card max-h-[90vh] overflow-y-auto">
          <header className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
            <h2 className="font-medium">{project ? 'Edit project' : 'Add project'}</h2>
            <button className="btn-ghost" type="button" onClick={onClose}>
              ✕
            </button>
          </header>
          <div className="p-4">
            <ProjectSettingsForm
              project={project}
              showHeader={false}
              embedded
              onSaved={(saved) => onSaved(saved as ProjectWithCount)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
