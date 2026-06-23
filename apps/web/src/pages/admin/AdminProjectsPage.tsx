import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Project } from '@cpwork/shared';
import { api, getApiErrorMessage } from '../../lib/api';
import { ConfirmDeleteModal } from '../../components/ConfirmDeleteModal';

type ProjectWithCount = Project & { userCount: number; hasJiraToken: boolean; hasGitToken?: boolean };

const emptyForm = {
  name: '',
  slug: '',
  description: '',
  frontendTheme: '',
  defaultProjectRoot: '',
  defaultFrontendUrl: '',
  defaultBackendUrl: '',
  productionBranch: 'production',
  stagingBranch: 'staging',
  prTargetBranch: 'staging',
  prProvider: '' as '' | 'github' | 'bitbucket',
  repoOwner: '',
  repoName: '',
  gitApiUsername: '',
  gitApiToken: '',
  jiraBaseUrl: '',
  jiraProjectKey: '',
  jiraEmail: '',
  jiraApiToken: '',
};

type FormState = typeof emptyForm;

export function AdminProjectsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ProjectWithCount | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<ProjectWithCount | null>(null);

  const projectsQ = useQuery({
    queryKey: ['admin', 'projects'],
    queryFn: async () =>
      (await api.get<{ projects: ProjectWithCount[] }>('/admin/projects')).data.projects,
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

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Slug</th>
              <th className="px-4 py-2">Default path</th>
              <th className="px-4 py-2">Jira</th>
              <th className="px-4 py-2">Users</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(projectsQ.data ?? []).map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-2 font-medium">{p.name}</td>
                <td className="px-4 py-2 text-slate-500">{p.slug}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-500">
                  {p.defaults.projectRoot || '—'}
                </td>
                <td className="px-4 py-2 text-slate-500">{p.jira.projectKey ?? '—'}</td>
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
          onSaved={() => {
            setCreating(false);
            setEditing(null);
            invalidate();
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

function toForm(p: ProjectWithCount | null): FormState {
  if (!p) return { ...emptyForm };
  return {
    name: p.name,
    slug: p.slug,
    description: p.description ?? '',
    frontendTheme: p.frontendTheme ?? '',
    defaultProjectRoot: p.defaults.projectRoot,
    defaultFrontendUrl: p.defaults.frontendUrl ?? '',
    defaultBackendUrl: p.defaults.backendUrl ?? '',
    productionBranch: p.git.productionBranch,
    stagingBranch: p.git.stagingBranch,
    prTargetBranch: p.git.prTargetBranch,
    prProvider: (p.git.prProvider as '' | 'github' | 'bitbucket') ?? '',
    repoOwner: p.git.repoOwner ?? '',
    repoName: p.git.repoName ?? '',
    gitApiUsername: p.git.apiUsername ?? '',
    gitApiToken: '',
    jiraBaseUrl: p.jira.baseUrl ?? '',
    jiraProjectKey: p.jira.projectKey ?? '',
    jiraEmail: p.jira.email ?? '',
    jiraApiToken: '',
  };
}

function ProjectModal({
  project,
  onClose,
  onSaved,
}: {
  project: ProjectWithCount | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(toForm(project));
  const [tokenFlags, setTokenFlags] = useState({
    hasGitToken: project?.hasGitToken ?? false,
    hasJiraToken: project?.hasJiraToken ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const [jiraTest, setJiraTest] = useState<string | null>(null);
  const [gitTest, setGitTest] = useState<string | null>(null);

  // Detect themes on disk for the existing project (admin's checkout).
  const themesQ = useQuery({
    queryKey: ['admin', 'project-themes', project?.id],
    queryFn: async () =>
      (await api.get<{ themes: string[]; scannedPath: string | null }>(
        `/admin/projects/${project!.id}/themes`,
      )).data,
    enabled: !!project,
  });
  const detectedThemes = themesQ.data?.themes ?? [];

  const jiraTestMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/admin/projects/${project!.id}/jira/test`, {
          baseUrl: form.jiraBaseUrl || null,
          email: form.jiraEmail || null,
          ...(form.jiraApiToken ? { apiToken: form.jiraApiToken } : {}),
        })
      ).data,
    onMutate: () => {
      setJiraTest(null);
      setError(null);
    },
    onSuccess: (data: { displayName?: string }) =>
      setJiraTest(`Connected as ${data.displayName ?? 'Jira user'} ✓`),
    onError: (err) => setJiraTest(`✗ ${getApiErrorMessage(err)}`),
  });

  const gitTestMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/admin/projects/${project!.id}/git/test`, {
          prProvider: form.prProvider || null,
          repoOwner: form.repoOwner || null,
          repoName: form.repoName || null,
          apiUsername: form.gitApiUsername || null,
          ...(form.gitApiToken ? { apiToken: form.gitApiToken } : {}),
        })
      ).data,
    onMutate: () => {
      setGitTest(null);
      setError(null);
    },
    onSuccess: (data: { fullName?: string; provider?: string }) =>
      setGitTest(`Connected to ${data.fullName ?? 'repository'} (${data.provider}) ✓`),
    onError: (err) => setGitTest(`✗ ${getApiErrorMessage(err)}`),
  });

  const gitDetectMutation = useMutation({
    mutationFn: async () =>
      (
        await api.get<{ detected: { owner: string; name: string; provider: string } }>(
          `/admin/projects/${project!.id}/git/detect`,
        )
      ).data,
    onSuccess: (data) => {
      setForm((f) => ({
        ...f,
        prProvider: (data.detected.provider as 'github' | 'bitbucket') || f.prProvider,
        repoOwner: data.detected.owner,
        repoName: data.detected.name,
      }));
      setGitTest(`Detected ${data.detected.owner}/${data.detected.name} from git remote`);
    },
    onError: (err) => setGitTest(`✗ ${getApiErrorMessage(err)}`),
  });

  const payload = () => ({
    name: form.name,
    slug: form.slug,
    description: form.description || null,
    frontendTheme: form.frontendTheme || null,
    defaults: {
      projectRoot: form.defaultProjectRoot,
      frontendUrl: form.defaultFrontendUrl || null,
      backendUrl: form.defaultBackendUrl || null,
    },
    git: {
      productionBranch: form.productionBranch,
      stagingBranch: form.stagingBranch,
      prTargetBranch: form.prTargetBranch,
      prProvider: form.prProvider || null,
      repoOwner: form.repoOwner || null,
      repoName: form.repoName || null,
      apiUsername: form.gitApiUsername || null,
      ...(form.gitApiToken ? { apiToken: form.gitApiToken } : {}),
    },
    jira: {
      baseUrl: form.jiraBaseUrl || null,
      projectKey: form.jiraProjectKey || null,
      email: form.jiraEmail || null,
      // Only send the token when the admin typed a new one.
      ...(form.jiraApiToken ? { apiToken: form.jiraApiToken } : {}),
    },
  });

  const mutation = useMutation({
    mutationFn: async () =>
      project
        ? api.put(`/admin/projects/${project.id}`, payload())
        : api.post('/admin/projects', payload()),
    onSuccess: (res) => {
      const saved = res.data?.project as ProjectWithCount | undefined;
      if (saved) {
        setTokenFlags({
          hasGitToken: !!saved.hasGitToken,
          hasJiraToken: !!saved.hasJiraToken,
        });
        setForm((f) => ({ ...f, gitApiToken: '', jiraApiToken: '' }));
      }
      onSaved();
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl">
        <div className="card">
          <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="font-medium">{project ? 'Edit project' : 'Add project'}</h2>
            <button className="btn-ghost" onClick={onClose}>
              ✕
            </button>
          </header>
          <div className="grid max-h-[70vh] gap-4 overflow-y-auto p-4 sm:grid-cols-2">
            <Field label="Name">
              <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="Slug (a-z 0-9 -)">
              <input className="input" value={form.slug} onChange={(e) => set('slug', e.target.value)} />
            </Field>
            <Field label="Description" full>
              <textarea
                className="input min-h-[100px] resize-y"
                value={form.description}
                onChange={(e) => set('description', e.target.value)}
              />
            </Field>
            <Field label="Default project root" full>
              <input
                className="input font-mono"
                placeholder="/var/www/html/colemans"
                value={form.defaultProjectRoot}
                onChange={(e) => set('defaultProjectRoot', e.target.value)}
              />
            </Field>
            <Field label="Active frontend theme" full>
              <input
                className="input font-mono"
                list="theme-options"
                placeholder="e.g. BlueAcorn/site or CP/colemans"
                value={form.frontendTheme}
                onChange={(e) => set('frontendTheme', e.target.value)}
              />
              <datalist id="theme-options">
                {detectedThemes.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <p className="mt-1 text-xs text-slate-400">
                {project
                  ? detectedThemes.length
                    ? `Detected on disk: ${detectedThemes.join(', ')}. The agent edits only this theme.`
                    : themesQ.isLoading
                      ? 'Scanning project for themes…'
                      : 'No themes detected at the project path. You can still type one.'
                  : 'Save the project first to auto-detect themes; or type Vendor/theme.'}
              </p>
            </Field>
            <Field label="Default frontend URL">
              <input
                className="input"
                value={form.defaultFrontendUrl}
                onChange={(e) => set('defaultFrontendUrl', e.target.value)}
              />
            </Field>
            <Field label="Default backend URL">
              <input
                className="input"
                value={form.defaultBackendUrl}
                onChange={(e) => set('defaultBackendUrl', e.target.value)}
              />
            </Field>
            <Field label="Production branch">
              <input
                className="input"
                value={form.productionBranch}
                onChange={(e) => set('productionBranch', e.target.value)}
              />
            </Field>
            <Field label="Staging branch">
              <input
                className="input"
                value={form.stagingBranch}
                onChange={(e) => set('stagingBranch', e.target.value)}
              />
            </Field>
            <Field label="PR target branch">
              <input
                className="input"
                value={form.prTargetBranch}
                onChange={(e) => set('prTargetBranch', e.target.value)}
              />
            </Field>
            <Field label="PR provider (Git host)" full>
              <select
                className="input"
                value={form.prProvider}
                onChange={(e) =>
                  set('prProvider', e.target.value as '' | 'github' | 'bitbucket')
                }
              >
                <option value="">Auto-detect from git remote</option>
                <option value="bitbucket">Bitbucket</option>
                <option value="github">GitHub</option>
              </select>
            </Field>
            <Field label="Repository owner (workspace / org)">
              <div className="flex gap-2">
                <input
                  className="input"
                  placeholder="e.g. cp-jira"
                  value={form.repoOwner}
                  onChange={(e) => set('repoOwner', e.target.value)}
                />
                {project && (
                  <button
                    type="button"
                    className="btn-secondary whitespace-nowrap text-xs"
                    disabled={gitDetectMutation.isPending}
                    onClick={() => gitDetectMutation.mutate()}
                  >
                    Detect
                  </button>
                )}
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Bitbucket workspace from your git remote (e.g. cp-jira for
                bitbucket.org/cp-jira/fabric5anddime_m2).
              </p>
            </Field>
            <Field label="Repository name">
              <input
                className="input"
                placeholder="e.g. fabric-magento"
                value={form.repoName}
                onChange={(e) => set('repoName', e.target.value)}
              />
            </Field>
            <Field label="Git API username (Bitbucket)">
              <input
                className="input"
                placeholder="Bitbucket username"
                value={form.gitApiUsername}
                onChange={(e) => set('gitApiUsername', e.target.value)}
              />
            </Field>
            <Field label="Git API token / App Password">
              <input
                className="input"
                type="password"
                placeholder={
                  tokenFlags.hasGitToken
                    ? '•••••• (leave blank to keep saved token)'
                    : 'Paste Bitbucket App Password (required)'
                }
                value={form.gitApiToken}
                onChange={(e) => set('gitApiToken', e.target.value)}
              />
              {tokenFlags.hasGitToken && (
                <p className="mt-1 text-xs text-green-700">Git token saved for this project.</p>
              )}
              <p className="mt-1 text-xs text-slate-400">
                Bitbucket: App Password with Pull requests write. GitHub: PAT with repo scope.
              </p>
            </Field>
            <Field label="Jira base URL">
              <input
                className="input"
                placeholder="https://company.atlassian.net"
                value={form.jiraBaseUrl}
                onChange={(e) => set('jiraBaseUrl', e.target.value)}
              />
            </Field>
            <Field label="Jira project key">
              <input
                className="input"
                placeholder="COL"
                value={form.jiraProjectKey}
                onChange={(e) => set('jiraProjectKey', e.target.value)}
              />
            </Field>
            <Field label="Jira email">
              <input
                className="input"
                placeholder="dev@company.com"
                value={form.jiraEmail}
                onChange={(e) => set('jiraEmail', e.target.value)}
              />
            </Field>
            <Field label="Jira API token">
              <input
                className="input"
                type="password"
                placeholder={
                  tokenFlags.hasJiraToken ? '•••••• (leave blank to keep)' : 'Paste API token'
                }
                value={form.jiraApiToken}
                onChange={(e) => set('jiraApiToken', e.target.value)}
              />
              {tokenFlags.hasJiraToken && (
                <p className="mt-1 text-xs text-green-700">Jira token saved for this project.</p>
              )}
            </Field>
          </div>
          {error && (
            <div className="mx-4 mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
          {jiraTest && (
            <div
              className={[
                'mx-4 mb-3 rounded-md px-3 py-2 text-sm',
                jiraTest.startsWith('✗')
                  ? 'bg-red-50 text-red-700'
                  : 'bg-green-50 text-green-700',
              ].join(' ')}
            >
              {jiraTest}
            </div>
          )}
          {gitTest && (
            <div
              className={[
                'mx-4 mb-3 rounded-md px-3 py-2 text-sm',
                gitTest.startsWith('✗')
                  ? 'bg-red-50 text-red-700'
                  : 'bg-green-50 text-green-700',
              ].join(' ')}
            >
              {gitTest}
            </div>
          )}
          <footer className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-4 py-3">
            {project && (
              <>
                <button
                  className="btn-secondary mr-auto"
                  disabled={gitTestMutation.isPending}
                  onClick={() => gitTestMutation.mutate()}
                  title="Uses form values; saved project token is used when the field is left blank"
                >
                  {gitTestMutation.isPending ? 'Testing…' : 'Test Git / PR'}
                </button>
                <button
                  className="btn-secondary"
                  disabled={jiraTestMutation.isPending}
                  onClick={() => jiraTestMutation.mutate()}
                  title="Uses form values; saved project token is used when the field is left blank"
                >
                  {jiraTestMutation.isPending ? 'Testing…' : 'Test Jira'}
                </button>
              </>
            )}
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
          </footer>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}
