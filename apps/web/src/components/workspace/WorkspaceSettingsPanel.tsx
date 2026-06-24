import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { EnvironmentHealth, Project, ProjectDefaults, UserProjectEnvironment } from '@cpwork/shared';
import { api, getApiErrorMessage } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { ConfirmDeleteModal } from '../ConfirmDeleteModal';
import type { ProjectWithMeta } from './ProjectSettingsForm';

function Field({
  label,
  children,
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="label">{label}</label>
      {children}
    </div>
  );
}

function SectionCard({
  title,
  children,
  className = '',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={[
        'rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-800/90',
        className,
      ].join(' ')}
    >
      <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {title}
      </h3>
      {children}
    </section>
  );
}

function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        className="input pr-10"
        type={show ? 'text' : 'password'}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        onClick={() => setShow((s) => !s)}
        tabIndex={-1}
        aria-label={show ? 'Hide password' : 'Show password'}
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function HealthStatusBar({ health }: { health: EnvironmentHealth | null }) {
  if (!health) {
    return (
      <SectionCard title="Health Status">
        <p className="text-sm text-slate-500">
          Run <strong>Test Environment</strong> to verify your local setup.
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Health Status">
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={[
            'badge px-3 py-1 text-sm font-medium',
            health.ok
              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
              : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
          ].join(' ')}
        >
          {health.ok ? 'Healthy' : 'Issues found'}
        </span>
        <div className="flex flex-1 flex-wrap gap-x-5 gap-y-2">
          {health.checks.map((c) => (
            <span
              key={c.key}
              className="inline-flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300"
            >
              <span className={c.ok ? 'text-green-500' : 'text-red-500'}>{c.ok ? '✓' : '✗'}</span>
              <span>{c.label}</span>
              {c.detail && (
                <span className="text-xs text-slate-400">({c.detail})</span>
              )}
            </span>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}

interface WorkspaceSettingsPanelProps {
  projectId: string;
  admin: boolean;
  project?: Project | null;
}

export function WorkspaceSettingsPanel({
  projectId,
  admin,
  project,
}: WorkspaceSettingsPanelProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { session, setJiraAccount } = useAuth();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gitTest, setGitTest] = useState<string | null>(null);
  const [jiraTest, setJiraTest] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [health, setHealth] = useState<EnvironmentHealth | null>(null);
  const [jiraIdentity, setJiraIdentity] = useState(session?.user.jiraAccountId ?? '');
  const [initialised, setInitialised] = useState(false);

  const adminProjectQ = useQuery({
    queryKey: ['admin', 'projects'],
    queryFn: async () =>
      (await api.get<{ projects: ProjectWithMeta[] }>('/admin/projects')).data.projects,
    enabled: admin,
  });
  const adminProject = adminProjectQ.data?.find((p) => p.id === projectId) ?? null;

  const envQ = useQuery({
    queryKey: ['my-environment', projectId],
    queryFn: async () =>
      (
        await api.get<{
          environment: UserProjectEnvironment | null;
          defaults: ProjectDefaults;
          hasDatabasePassword?: boolean;
          detectedDatabase?: {
            name?: string;
            user?: string;
            host?: string;
            port?: number;
            dockerComposePath?: string | null;
          } | null;
        }>(`/projects/${projectId}/my-environment`)
      ).data,
  });

  const themesQ = useQuery({
    queryKey: ['admin', 'project-themes', projectId],
    queryFn: async () =>
      (
        await api.get<{ themes: string[]; scannedPath: string | null }>(
          `/admin/projects/${projectId}/themes`,
        )
      ).data,
    enabled: admin,
  });

  const [form, setForm] = useState({
    name: '',
    slug: '',
    description: '',
    projectRoot: '',
    frontendTheme: '',
    productionBranch: 'production',
    stagingBranch: 'staging',
    prTargetBranch: 'staging',
    frontendUrl: '',
    backendUrl: '',
    dockerComposePath: '',
    databaseHost: '',
    databasePort: '',
    databaseName: '',
    databaseUser: '',
    databasePassword: '',
    prProvider: '' as '' | 'github' | 'bitbucket',
    repoOwner: '',
    repoName: '',
    gitApiUsername: '',
    gitApiToken: '',
    jiraBaseUrl: '',
    jiraProjectKey: '',
    jiraEmail: '',
    jiraApiToken: '',
  });
  const [hasDatabasePassword, setHasDatabasePassword] = useState(false);
  const [hasGitToken, setHasGitToken] = useState(false);
  const [hasJiraToken, setHasJiraToken] = useState(false);

  const source = admin ? adminProject : project;

  useEffect(() => {
    setInitialised(false);
  }, [projectId]);

  useEffect(() => {
    if (!(admin ? adminProjectQ.data : project) || !envQ.data || initialised) return;
    const env = envQ.data.environment;
    const def = envQ.data.defaults;
    const p = source;
    setForm({
      name: p?.name ?? '',
      slug: p?.slug ?? '',
      description: p?.description ?? '',
      projectRoot: env?.projectRoot ?? def.projectRoot ?? p?.defaults.projectRoot ?? '',
      frontendTheme: p?.frontendTheme ?? '',
      productionBranch: p?.git.productionBranch ?? 'production',
      stagingBranch: p?.git.stagingBranch ?? 'staging',
      prTargetBranch: p?.git.prTargetBranch ?? 'staging',
      frontendUrl: env?.frontendUrl ?? def.frontendUrl ?? p?.defaults.frontendUrl ?? '',
      backendUrl: env?.backendUrl ?? def.backendUrl ?? p?.defaults.backendUrl ?? '',
      dockerComposePath:
        env?.dockerComposePath ?? envQ.data.detectedDatabase?.dockerComposePath ?? '',
      databaseHost: env?.databaseHost ?? envQ.data.detectedDatabase?.host ?? '',
      databasePort: env?.databasePort
        ? String(env.databasePort)
        : envQ.data.detectedDatabase?.port
          ? String(envQ.data.detectedDatabase.port)
          : '',
      databaseName: env?.databaseName ?? envQ.data.detectedDatabase?.name ?? '',
      databaseUser: env?.databaseUser ?? envQ.data.detectedDatabase?.user ?? '',
      databasePassword: '',
      prProvider: (p?.git.prProvider as '' | 'github' | 'bitbucket') ?? '',
      repoOwner: p?.git.repoOwner ?? '',
      repoName: p?.git.repoName ?? '',
      gitApiUsername: p?.git.apiUsername ?? '',
      gitApiToken: '',
      jiraBaseUrl: p?.jira.baseUrl ?? '',
      jiraProjectKey: p?.jira.projectKey ?? '',
      jiraEmail: p?.jira.email ?? '',
      jiraApiToken: '',
    });
    setHasDatabasePassword(Boolean(envQ.data.hasDatabasePassword));
    setHasGitToken(Boolean(adminProject?.hasGitToken));
    setHasJiraToken(Boolean(adminProject?.hasJiraToken));
    setHealth(env?.lastHealth ?? null);
    setInitialised(true);
  }, [admin, adminProject, adminProjectQ.data, envQ.data, initialised, project, source]);

  function patch<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const testEnvMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ health: EnvironmentHealth }>(
          `/projects/${projectId}/my-environment/test`,
          {
            projectRoot: form.projectRoot,
            databaseHost: form.databaseHost || null,
            databasePort: form.databasePort ? Number(form.databasePort) : null,
            databaseName: form.databaseName || null,
            databaseUser: form.databaseUser || null,
            dockerComposePath: form.dockerComposePath || null,
            ...(form.databasePassword ? { databasePassword: form.databasePassword } : {}),
          },
        )
      ).data.health,
    onSuccess: (h) => {
      setHealth(h);
      setError(null);
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const gitTestMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/admin/projects/${projectId}/git/test`, {
          prProvider: form.prProvider || null,
          repoOwner: form.repoOwner || null,
          repoName: form.repoName || null,
          apiUsername: form.gitApiUsername || null,
          ...(form.gitApiToken ? { apiToken: form.gitApiToken } : {}),
        })
      ).data,
    onSuccess: (data: { fullName?: string; provider?: string }) => {
      setGitTest(`Connected to ${data.fullName ?? 'repository'} (${data.provider}) ✓`);
      setError(null);
    },
    onError: (err) => setGitTest(`✗ ${getApiErrorMessage(err)}`),
  });

  const jiraTestMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/admin/projects/${projectId}/jira/test`, {
          baseUrl: form.jiraBaseUrl || null,
          email: form.jiraEmail || null,
          ...(form.jiraApiToken ? { apiToken: form.jiraApiToken } : {}),
        })
      ).data,
    onSuccess: (data: { displayName?: string }) => {
      setJiraTest(`Connected as ${data.displayName ?? 'Jira user'} ✓`);
      setError(null);
    },
    onError: (err) => setJiraTest(`✗ ${getApiErrorMessage(err)}`),
  });

  const gitDetectMutation = useMutation({
    mutationFn: async () =>
      (
        await api.get<{ detected: { owner: string; name: string; provider: string } }>(
          `/admin/projects/${projectId}/git/detect`,
        )
      ).data,
    onSuccess: (data) => {
      patch('prProvider', (data.detected.provider as 'github' | 'bitbucket') || form.prProvider);
      patch('repoOwner', data.detected.owner);
      patch('repoName', data.detected.name);
      setGitTest(`Detected ${data.detected.owner}/${data.detected.name}`);
    },
    onError: (err) => setGitTest(`✗ ${getApiErrorMessage(err)}`),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const envPayload = {
        projectRoot: form.projectRoot,
        frontendUrl: form.frontendUrl || null,
        backendUrl: form.backendUrl || null,
        databaseHost: form.databaseHost || null,
        databasePort: form.databasePort ? Number(form.databasePort) : null,
        databaseName: form.databaseName || null,
        databaseUser: form.databaseUser || null,
        dockerComposePath: form.dockerComposePath || null,
        ...(form.databasePassword ? { databasePassword: form.databasePassword } : {}),
      };

      const tasks: Promise<unknown>[] = [
        api.put(`/projects/${projectId}/my-environment`, envPayload),
      ];

      if (admin) {
        tasks.push(
          api.put(`/admin/projects/${projectId}`, {
            name: form.name,
            slug: form.slug,
            description: form.description || null,
            frontendTheme: form.frontendTheme || null,
            defaults: {
              projectRoot: form.projectRoot,
              frontendUrl: form.frontendUrl || null,
              backendUrl: form.backendUrl || null,
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
          }),
        );
      }

      if (jiraIdentity !== (session?.user.jiraAccountId ?? '')) {
        tasks.push(setJiraAccount(jiraIdentity.trim() || null));
      }

      await Promise.all(tasks);
    },
    onSuccess: () => {
      setSaved(true);
      setError(null);
      if (form.databasePassword) {
        setHasDatabasePassword(true);
        patch('databasePassword', '');
      }
      if (form.gitApiToken) patch('gitApiToken', '');
      if (form.jiraApiToken) patch('jiraApiToken', '');
      void qc.invalidateQueries({ queryKey: ['projects'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'projects'] });
      void qc.invalidateQueries({ queryKey: ['my-environment', projectId] });
      void qc.invalidateQueries({ queryKey: ['project', projectId] });
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => api.delete(`/admin/projects/${projectId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'projects'] });
      navigate('/workspaces');
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  if (envQ.isLoading || (admin && adminProjectQ.isLoading)) {
    return <p className="text-sm text-slate-500">Loading settings…</p>;
  }

  const detectedThemes = themesQ.data?.themes ?? [];
  const readOnly = !admin;

  return (
    <div className="space-y-5">
      {/* Project Information */}
      <SectionCard title="Project Information">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project Name">
            <input
              className="input"
              value={form.name}
              readOnly={readOnly}
              onChange={(e) => patch('name', e.target.value)}
            />
          </Field>
          <Field label="Project Key / Slug">
            <input
              className="input font-mono"
              value={form.slug}
              readOnly={readOnly}
              onChange={(e) => patch('slug', e.target.value)}
            />
          </Field>
          <Field label="Project Description" className="sm:col-span-2">
            <textarea
              className="input min-h-[88px] resize-y"
              value={form.description}
              readOnly={readOnly}
              onChange={(e) => patch('description', e.target.value)}
            />
          </Field>
        </div>
      </SectionCard>

      {/* Two-column: Local Environment | Repository & Access */}
      <div className="grid gap-5 lg:grid-cols-2">
        <SectionCard title="Local Environment">
          <div className="space-y-4">
            <Field label="Project Root Path">
              <input
                className="input font-mono text-sm"
                value={form.projectRoot}
                onChange={(e) => patch('projectRoot', e.target.value)}
              />
            </Field>

            <Field label="Active Frontend Theme">
              <input
                className="input font-mono text-sm"
                list="ws-theme-options"
                value={form.frontendTheme}
                readOnly={readOnly}
                onChange={(e) => patch('frontendTheme', e.target.value)}
              />
              <datalist id="ws-theme-options">
                {detectedThemes.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              {admin && detectedThemes.length > 0 && (
                <p className="mt-1 text-xs text-slate-400">
                  Detected: {detectedThemes.join(', ')}
                </p>
              )}
            </Field>

            <div>
              <label className="label">Default Branches</label>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <span className="mb-1 block text-xs text-slate-400">Production</span>
                  <input
                    className="input text-sm"
                    value={form.productionBranch}
                    readOnly={readOnly}
                    onChange={(e) => patch('productionBranch', e.target.value)}
                  />
                </div>
                <div>
                  <span className="mb-1 block text-xs text-slate-400">Staging</span>
                  <input
                    className="input text-sm"
                    value={form.stagingBranch}
                    readOnly={readOnly}
                    onChange={(e) => patch('stagingBranch', e.target.value)}
                  />
                </div>
                <div>
                  <span className="mb-1 block text-xs text-slate-400">PR Target</span>
                  <input
                    className="input text-sm"
                    value={form.prTargetBranch}
                    readOnly={readOnly}
                    onChange={(e) => patch('prTargetBranch', e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Frontend URL">
                <input
                  className="input"
                  value={form.frontendUrl}
                  onChange={(e) => patch('frontendUrl', e.target.value)}
                />
              </Field>
              <Field label="Backend URL">
                <input
                  className="input"
                  value={form.backendUrl}
                  onChange={(e) => patch('backendUrl', e.target.value)}
                />
              </Field>
            </div>

            <Field label="Docker Compose File (optional)">
              <input
                className="input font-mono text-sm"
                placeholder="docker-compose.yaml"
                value={form.dockerComposePath}
                onChange={(e) => patch('dockerComposePath', e.target.value)}
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Database Host">
                <input
                  className="input"
                  placeholder="127.0.0.1"
                  value={form.databaseHost}
                  onChange={(e) => patch('databaseHost', e.target.value)}
                />
              </Field>
              <Field label="Database Port">
                <input
                  className="input"
                  placeholder="3306"
                  value={form.databasePort}
                  onChange={(e) => patch('databasePort', e.target.value)}
                />
              </Field>
              <Field label="Database Name">
                <input
                  className="input"
                  value={form.databaseName}
                  onChange={(e) => patch('databaseName', e.target.value)}
                />
              </Field>
              <Field label="Database User">
                <input
                  className="input"
                  value={form.databaseUser}
                  onChange={(e) => patch('databaseUser', e.target.value)}
                />
              </Field>
              <Field label="Database Password" className="sm:col-span-2">
                <PasswordInput
                  value={form.databasePassword}
                  placeholder={
                    hasDatabasePassword ? '•••••• (leave blank to keep)' : 'Database password'
                  }
                  onChange={(v) => patch('databasePassword', v)}
                />
              </Field>
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                className="btn-secondary"
                disabled={testEnvMutation.isPending || !form.projectRoot}
                onClick={() => testEnvMutation.mutate()}
              >
                {testEnvMutation.isPending ? 'Testing…' : 'Test Environment'}
              </button>
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Repository & Access">
          <div className="space-y-4">
            <Field label="Git Provider">
              <select
                className="input"
                value={form.prProvider}
                disabled={readOnly}
                onChange={(e) =>
                  patch('prProvider', e.target.value as '' | 'github' | 'bitbucket')
                }
              >
                <option value="">Auto-detect from git remote</option>
                <option value="bitbucket">Bitbucket</option>
                <option value="github">GitHub</option>
              </select>
            </Field>

            <Field label="Repository (Workspace / Org)">
              <div className="flex gap-2">
                <input
                  className="input"
                  placeholder="e.g. cp-jira"
                  value={form.repoOwner}
                  readOnly={readOnly}
                  onChange={(e) => patch('repoOwner', e.target.value)}
                />
                {admin && (
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
            </Field>

            <Field label="Repository Name">
              <input
                className="input"
                placeholder="e.g. fabric-magento"
                value={form.repoName}
                readOnly={readOnly}
                onChange={(e) => patch('repoName', e.target.value)}
              />
            </Field>

            <Field label="Git API Username (Bitbucket)">
              <input
                className="input"
                value={form.gitApiUsername}
                readOnly={readOnly}
                onChange={(e) => patch('gitApiUsername', e.target.value)}
              />
            </Field>

            <Field label="App Password / Token">
              <PasswordInput
                value={form.gitApiToken}
                placeholder={
                  hasGitToken
                    ? '•••••• (leave blank to keep)'
                    : 'Paste Bitbucket App Password or GitHub PAT'
                }
                onChange={(v) => patch('gitApiToken', v)}
              />
              {readOnly && (
                <p className="mt-1 text-xs text-slate-400">Contact an admin to update Git tokens.</p>
              )}
            </Field>

            <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
              <h4 className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                Jira Configuration
              </h4>
              <div className="space-y-3">
                <Field label="Jira Base URL">
                  <input
                    className="input"
                    placeholder="https://company.atlassian.net"
                    value={form.jiraBaseUrl}
                    readOnly={readOnly}
                    onChange={(e) => patch('jiraBaseUrl', e.target.value)}
                  />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Jira Project Key">
                    <input
                      className="input"
                      placeholder="CBSI"
                      value={form.jiraProjectKey}
                      readOnly={readOnly}
                      onChange={(e) => patch('jiraProjectKey', e.target.value)}
                    />
                  </Field>
                  <Field label="Jira Email">
                    <input
                      className="input"
                      placeholder="dev@company.com"
                      value={form.jiraEmail}
                      readOnly={readOnly}
                      onChange={(e) => patch('jiraEmail', e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Jira API Token">
                  <PasswordInput
                    value={form.jiraApiToken}
                    placeholder={
                      hasJiraToken ? '•••••• (leave blank to keep)' : 'Paste API token'
                    }
                    onChange={(v) => patch('jiraApiToken', v)}
                  />
                </Field>
              </div>
            </div>

            <div className="border-t border-slate-200 pt-4 dark:border-slate-700">
              <h4 className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-200">
                My Jira Identity
              </h4>
              <p className="mb-2 text-xs text-slate-400">
                Used to filter tasks assigned to you (accountId for Cloud, username for Server).
              </p>
              <input
                className="input"
                placeholder="e.g. 5b10ac8d82e05b22cc7d4ef5 or jdoe"
                value={jiraIdentity}
                onChange={(e) => setJiraIdentity(e.target.value)}
              />
            </div>

            {admin && (
              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={gitTestMutation.isPending}
                  onClick={() => gitTestMutation.mutate()}
                >
                  {gitTestMutation.isPending ? 'Testing…' : 'Test Connection'}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={jiraTestMutation.isPending}
                  onClick={() => jiraTestMutation.mutate()}
                >
                  {jiraTestMutation.isPending ? 'Testing…' : 'Test Jira Access'}
                </button>
              </div>
            )}

            {gitTest && (
              <p
                className={[
                  'text-sm',
                  gitTest.startsWith('✗') ? 'text-red-600' : 'text-green-600',
                ].join(' ')}
              >
                {gitTest}
              </p>
            )}
            {jiraTest && (
              <p
                className={[
                  'text-sm',
                  jiraTest.startsWith('✗') ? 'text-red-600' : 'text-green-600',
                ].join(' ')}
              >
                {jiraTest}
              </p>
            )}
          </div>
        </SectionCard>
      </div>

      <HealthStatusBar health={health} />

      {error && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Footer actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-5 dark:border-slate-700">
        {admin ? (
          <button
            type="button"
            className="btn-danger border border-red-200 px-4 py-2 dark:border-red-900"
            onClick={() => setDeleting(true)}
          >
            Delete Project
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-green-600">Saved ✓</span>}
          <button
            type="button"
            className="btn-primary px-6 py-2.5"
            disabled={saveMutation.isPending || !form.projectRoot}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>

      {deleting && (
        <ConfirmDeleteModal
          title={`Delete project "${form.name}"?`}
          message="This removes the project and all user assignments, environments, and runs linked to it. This cannot be undone."
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await deleteMutation.mutateAsync();
            setDeleting(false);
          }}
        />
      )}
    </div>
  );
}
