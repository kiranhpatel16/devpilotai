import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Project } from '@cpwork/shared';
import { api, getApiErrorMessage } from '../../lib/api';

export type ProjectWithMeta = Project & {
  userCount?: number;
  hasJiraToken: boolean;
  hasGitToken?: boolean;
};

const emptyForm = {
  name: '',
  slug: '',
  description: '',
  frontendTheme: '',
  defaultProjectRoot: '',
  defaultFrontendUrl: '',
  defaultBackendUrl: '',
  deployProfile: 'auto' as 'auto' | 'light' | 'standard' | 'full',
  deploySkipComposer: false,
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

function toForm(p: ProjectWithMeta | null): FormState {
  if (!p) return { ...emptyForm };
  return {
    name: p.name,
    slug: p.slug,
    description: p.description ?? '',
    frontendTheme: p.frontendTheme ?? '',
    defaultProjectRoot: p.defaults.projectRoot,
    defaultFrontendUrl: p.defaults.frontendUrl ?? '',
    defaultBackendUrl: p.defaults.backendUrl ?? '',
    deployProfile: p.defaults.deployProfile ?? 'auto',
    deploySkipComposer: p.defaults.deploySkipComposer ?? false,
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

function SettingsField({
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

interface ProjectSettingsFormProps {
  project: ProjectWithMeta | null;
  onSaved?: (project: ProjectWithMeta) => void;
  showHeader?: boolean;
  /** When true, skip outer card wrapper (e.g. inside admin modal). */
  embedded?: boolean;
}

export function ProjectSettingsForm({
  project,
  onSaved,
  showHeader = true,
  embedded = false,
}: ProjectSettingsFormProps) {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(() => toForm(project));
  const [tokenFlags, setTokenFlags] = useState({
    hasGitToken: project?.hasGitToken ?? false,
    hasJiraToken: project?.hasJiraToken ?? false,
  });
  const [error, setError] = useState<string | null>(null);
  const [jiraTest, setJiraTest] = useState<string | null>(null);
  const [gitTest, setGitTest] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const themesQ = useQuery({
    queryKey: ['admin', 'project-themes', project?.id],
    queryFn: async () =>
      (
        await api.get<{ themes: string[]; scannedPath: string | null }>(
          `/admin/projects/${project!.id}/themes`,
        )
      ).data,
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
      deployProfile: form.deployProfile,
      deploySkipComposer: form.deploySkipComposer,
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
      ...(form.jiraApiToken ? { apiToken: form.jiraApiToken } : {}),
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () =>
      project
        ? api.put(`/admin/projects/${project.id}`, payload())
        : api.post('/admin/projects', payload()),
    onSuccess: (res) => {
      const savedProject = res.data?.project as ProjectWithMeta | undefined;
      if (savedProject) {
        setTokenFlags({
          hasGitToken: !!savedProject.hasGitToken,
          hasJiraToken: !!savedProject.hasJiraToken,
        });
        setForm((f) => ({ ...f, gitApiToken: '', jiraApiToken: '' }));
        onSaved?.(savedProject);
      }
      setSaved(true);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['admin', 'projects'] });
      void qc.invalidateQueries({ queryKey: ['projects'] });
      if (project?.id) {
        void qc.invalidateQueries({ queryKey: ['project', project.id] });
      }
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const content = (
    <>
      {showHeader && (
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
            Project configuration
          </h2>
          <p className="text-sm text-slate-500">
            Shared defaults, Git/PR, Jira, and theme — applies to all users on this project.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <SettingsField label="Name">
          <input className="input" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </SettingsField>
        <SettingsField label="Slug (a-z 0-9 -)">
          <input className="input" value={form.slug} onChange={(e) => set('slug', e.target.value)} />
        </SettingsField>
        <SettingsField label="Description" full>
          <textarea
            className="input min-h-[100px] resize-y"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </SettingsField>
        <SettingsField label="Default project root" full>
          <input
            className="input font-mono"
            placeholder="/var/www/html/colemans"
            value={form.defaultProjectRoot}
            onChange={(e) => set('defaultProjectRoot', e.target.value)}
          />
        </SettingsField>
        <SettingsField label="Active frontend theme" full>
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
        </SettingsField>
        <SettingsField label="Default frontend URL">
          <input
            className="input"
            value={form.defaultFrontendUrl}
            onChange={(e) => set('defaultFrontendUrl', e.target.value)}
          />
        </SettingsField>
        <SettingsField label="Default backend URL">
          <input
            className="input"
            value={form.defaultBackendUrl}
            onChange={(e) => set('defaultBackendUrl', e.target.value)}
          />
        </SettingsField>
        <SettingsField label="Local deploy profile" full>
          <select
            className="input"
            value={form.deployProfile}
            onChange={(e) =>
              set('deployProfile', e.target.value as FormState['deployProfile'])
            }
          >
            <option value="auto">Auto — detect from changed files</option>
            <option value="light">Light — cache flush only</option>
            <option value="standard">Standard — DI compile + cache</option>
            <option value="full">Full — composer, upgrade, compile, static</option>
          </select>
          <p className="mt-1 text-xs text-slate-400">
            Auto picks light for .phtml/layout XML-only tasks; standard when PHP or di.xml changes;
            full when composer or module.xml changes.
          </p>
        </SettingsField>
        <SettingsField label="Skip composer install" full>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.deploySkipComposer}
              onChange={(e) => set('deploySkipComposer', e.target.checked)}
            />
            Never run <code className="font-mono text-xs">composer install</code> during local deploy
          </label>
        </SettingsField>
        <SettingsField label="Production branch">
          <input
            className="input"
            value={form.productionBranch}
            onChange={(e) => set('productionBranch', e.target.value)}
          />
        </SettingsField>
        <SettingsField label="Staging branch">
          <input
            className="input"
            value={form.stagingBranch}
            onChange={(e) => set('stagingBranch', e.target.value)}
          />
        </SettingsField>
        <SettingsField label="PR target branch">
          <input
            className="input"
            value={form.prTargetBranch}
            onChange={(e) => set('prTargetBranch', e.target.value)}
          />
        </SettingsField>
        <SettingsField label="PR provider (Git host)" full>
          <select
            className="input"
            value={form.prProvider}
            onChange={(e) => set('prProvider', e.target.value as '' | 'github' | 'bitbucket')}
          >
            <option value="">Auto-detect from git remote</option>
            <option value="bitbucket">Bitbucket</option>
            <option value="github">GitHub</option>
          </select>
        </SettingsField>
        <SettingsField label="Repository owner (workspace / org)">
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
        </SettingsField>
        <SettingsField label="Repository name">
          <input
            className="input"
            placeholder="e.g. fabric-magento"
            value={form.repoName}
            onChange={(e) => set('repoName', e.target.value)}
          />
        </SettingsField>
        <SettingsField label="Git API username (Bitbucket)">
          <input
            className="input"
            placeholder="Bitbucket username"
            value={form.gitApiUsername}
            onChange={(e) => set('gitApiUsername', e.target.value)}
          />
        </SettingsField>
        <SettingsField label="Git API token / App Password">
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
            <p className="mt-1 text-xs text-green-700 dark:text-green-400">
              Git token saved for this project.
            </p>
          )}
          <p className="mt-1 text-xs text-slate-400">
            Bitbucket: App Password with Pull requests write. GitHub: PAT with repo scope.
          </p>
        </SettingsField>
        <SettingsField label="Jira base URL">
          <input
            className="input"
            placeholder="https://company.atlassian.net"
            value={form.jiraBaseUrl}
            onChange={(e) => set('jiraBaseUrl', e.target.value)}
          />
        </SettingsField>
        <SettingsField label="Jira project key">
          <input
            className="input"
            placeholder="COL"
            value={form.jiraProjectKey}
            onChange={(e) => set('jiraProjectKey', e.target.value)}
          />
        </SettingsField>
        <SettingsField label="Jira email">
          <input
            className="input"
            placeholder="dev@company.com"
            value={form.jiraEmail}
            onChange={(e) => set('jiraEmail', e.target.value)}
          />
        </SettingsField>
        <SettingsField label="Jira API token">
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
            <p className="mt-1 text-xs text-green-700 dark:text-green-400">
              Jira token saved for this project.
            </p>
          )}
        </SettingsField>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}
      {jiraTest && (
        <div
          className={[
            'rounded-md px-3 py-2 text-sm',
            jiraTest.startsWith('✗')
              ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
              : 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300',
          ].join(' ')}
        >
          {jiraTest}
        </div>
      )}
      {gitTest && (
        <div
          className={[
            'rounded-md px-3 py-2 text-sm',
            gitTest.startsWith('✗')
              ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
              : 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300',
          ].join(' ')}
        >
          {gitTest}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {project && (
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={gitTestMutation.isPending}
              onClick={() => gitTestMutation.mutate()}
            >
              {gitTestMutation.isPending ? 'Testing…' : 'Test Git / PR'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={jiraTestMutation.isPending}
              onClick={() => jiraTestMutation.mutate()}
            >
              {jiraTestMutation.isPending ? 'Testing…' : 'Test Jira'}
            </button>
          </>
        )}
        <button
          type="button"
          className="btn-primary ml-auto"
          disabled={saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? 'Saving…' : 'Save project'}
        </button>
        {saved && <span className="self-center text-sm text-green-600">Saved ✓</span>}
      </div>
    </>
  );

  if (embedded) {
    return <div className="space-y-4">{content}</div>;
  }

  return <div className="card space-y-4 p-6 shadow-card">{content}</div>;
}

export function ProjectSettingsEditor({ projectId }: { projectId: string }) {
  const projectsQ = useQuery({
    queryKey: ['admin', 'projects'],
    queryFn: async () =>
      (await api.get<{ projects: ProjectWithMeta[] }>('/admin/projects')).data.projects,
  });

  const project = projectsQ.data?.find((p) => p.id === projectId) ?? null;

  if (projectsQ.isLoading) {
    return <p className="text-sm text-slate-500">Loading project settings…</p>;
  }

  if (!project) {
    return (
      <p className="text-sm text-slate-500">
        Project not found or you do not have permission to edit it.
      </p>
    );
  }

  return <ProjectSettingsForm project={project} />;
}

export function ProjectSettingsSummary({ project }: { project: Project }) {
  return (
    <div className="card space-y-3 p-6 shadow-card">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{project.name}</h2>
        {project.description && (
          <p className="text-sm text-slate-500">{project.description}</p>
        )}
      </div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-slate-400">Jira key</dt>
          <dd className="font-medium text-slate-900 dark:text-white">
            {project.jira.projectKey ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Theme</dt>
          <dd className="font-mono text-slate-900 dark:text-white">
            {project.frontendTheme ?? '—'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Default path</dt>
          <dd className="font-mono text-xs text-slate-900 dark:text-white">
            {project.defaults.projectRoot || '—'}
          </dd>
        </div>
        <div>
          <dt className="text-slate-400">Branches</dt>
          <dd className="text-slate-900 dark:text-white">
            prod: {project.git.productionBranch}, staging: {project.git.stagingBranch}, PR →{' '}
            {project.git.prTargetBranch}
          </dd>
        </div>
      </dl>
      <p className="text-xs text-slate-400">
        Contact an admin to change project-level Git, Jira, or theme settings.
      </p>
    </div>
  );
}
