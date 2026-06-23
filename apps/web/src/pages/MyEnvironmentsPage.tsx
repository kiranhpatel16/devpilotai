import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  EnvironmentHealth,
  ProjectDefaults,
  UserProjectEnvironment,
} from '@cpwork/shared';
import { api, getApiErrorMessage } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import type { ProjectListItem } from '../lib/projects';

function JiraIdentityCard() {
  const { session, setJiraAccount } = useAuth();
  const [value, setValue] = useState(session?.user.jiraAccountId ?? '');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function detectFromJira() {
    setBusy(true);
    setStatus(null);
    try {
      const { data } = await api.post<{
        user: { jiraAccountId: string | null };
        detected?: { accountId: string; displayName?: string };
      }>('/auth/me/jira-account/detect', {});
      await setJiraAccount(data.user.jiraAccountId);
      setValue(data.user.jiraAccountId ?? '');
      setStatus(
        data.detected?.displayName
          ? `Detected ${data.detected.displayName} ✓`
          : 'Saved ✓',
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      await setJiraAccount(value.trim() || null);
      setStatus('Saved ✓');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4">
      <h2 className="font-medium">My Jira Identity</h2>
      <p className="mt-1 text-sm text-slate-500">
        Used to show only tasks assigned to you. For Jira Cloud use your{' '}
        <strong>accountId</strong>; for Server/DC use your username.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          className="input max-w-md"
          placeholder="e.g. 5b10ac8d82e05b22cc7d4ef5 or jdoe"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="btn-primary" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button className="btn-secondary" disabled={busy} onClick={() => void detectFromJira()}>
          Detect from Jira
        </button>
        {status && <span className="text-sm text-slate-500">{status}</span>}
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Tip: find your accountId in Jira via Profile, or the URL{' '}
        <code>/rest/api/3/myself</code>.
      </p>
    </div>
  );
}

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
          here.
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
            {openId === p.id && <EnvironmentEditor projectId={p.id} />}
          </div>
        ))}
      </div>
    </div>
  );
}

function EnvironmentEditor({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
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
            magentoHost?: string;
            connectVia?: string;
            dockerComposePath?: string | null;
            hasPassword?: boolean;
          } | null;
        }>(`/projects/${projectId}/my-environment`)
      ).data,
  });

  const [form, setForm] = useState({
    projectRoot: '',
    frontendUrl: '',
    backendUrl: '',
    databaseHost: '',
    databasePort: '',
    databaseName: '',
    databaseUser: '',
    databasePassword: '',
    dockerComposePath: '',
  });
  const [hasDatabasePassword, setHasDatabasePassword] = useState(false);
  const [initialised, setInitialised] = useState(false);
  const [health, setHealth] = useState<EnvironmentHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (envQ.data && !initialised) {
    const env = envQ.data.environment;
    const def = envQ.data.defaults;
    setForm({
      projectRoot: env?.projectRoot ?? def.projectRoot ?? '',
      frontendUrl: env?.frontendUrl ?? def.frontendUrl ?? '',
      backendUrl: env?.backendUrl ?? def.backendUrl ?? '',
      databaseHost: env?.databaseHost ?? '',
      databasePort: env?.databasePort ? String(env.databasePort) : '',
      databaseName: env?.databaseName ?? envQ.data.detectedDatabase?.name ?? '',
      databaseUser: env?.databaseUser ?? envQ.data.detectedDatabase?.user ?? '',
      databasePassword: '',
      dockerComposePath: env?.dockerComposePath ?? envQ.data.detectedDatabase?.dockerComposePath ?? '',
    });
    setHasDatabasePassword(Boolean(envQ.data.hasDatabasePassword));
    setHealth(env?.lastHealth ?? null);
    setInitialised(true);
  }

  const detectDbMutation = useMutation({
    mutationFn: async () =>
      (
        await api.get<{
          detected: {
            name?: string;
            user?: string;
            host?: string;
            port?: number;
            magentoHost?: string;
            connectVia?: string;
            dockerComposePath?: string | null;
            hasPassword?: boolean;
          };
        }>(`/projects/${projectId}/my-environment/detect-database`, {
          params: { projectRoot: form.projectRoot || undefined },
        })
      ).data.detected,
    onSuccess: (detected) => {
      setForm((f) => ({
        ...f,
        databaseName: detected.name ?? f.databaseName,
        databaseUser: detected.user ?? f.databaseUser,
        databaseHost: detected.host ?? f.databaseHost,
        databasePort: detected.port ? String(detected.port) : f.databasePort,
        dockerComposePath: detected.dockerComposePath ?? f.dockerComposePath,
      }));
      setError(null);
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const testMutation = useMutation({
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

  const saveMutation = useMutation({
    mutationFn: async () =>
      api.put(`/projects/${projectId}/my-environment`, {
        projectRoot: form.projectRoot,
        frontendUrl: form.frontendUrl || null,
        backendUrl: form.backendUrl || null,
        databaseHost: form.databaseHost || null,
        databasePort: form.databasePort ? Number(form.databasePort) : null,
        databaseName: form.databaseName || null,
        databaseUser: form.databaseUser || null,
        dockerComposePath: form.dockerComposePath || null,
        ...(form.databasePassword ? { databasePassword: form.databasePassword } : {}),
      }),
    onSuccess: () => {
      setSaved(true);
      setError(null);
      if (form.databasePassword) {
        setHasDatabasePassword(true);
        setForm((f) => ({ ...f, databasePassword: '' }));
      }
      void qc.invalidateQueries({ queryKey: ['projects'] });
      void qc.invalidateQueries({ queryKey: ['my-environment', projectId] });
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  if (envQ.isLoading) return <p className="px-4 pb-4 text-sm text-slate-400">Loading…</p>;

  return (
    <div className="space-y-4 border-t border-slate-200 px-4 py-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">Project path *</label>
          <input
            className="input font-mono"
            placeholder="/var/www/html/colemans-local"
            value={form.projectRoot}
            onChange={(e) => setForm({ ...form, projectRoot: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Frontend URL</label>
          <input
            className="input"
            value={form.frontendUrl}
            onChange={(e) => setForm({ ...form, frontendUrl: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Backend URL</label>
          <input
            className="input"
            value={form.backendUrl}
            onChange={(e) => setForm({ ...form, backendUrl: e.target.value })}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Docker compose file (optional)</label>
          <input
            className="input font-mono text-sm"
            placeholder="docker-compose.yaml (auto-detected in project root)"
            value={form.dockerComposePath}
            onChange={(e) => setForm({ ...form, dockerComposePath: e.target.value })}
          />
          <p className="mt-1 text-xs text-slate-400">
            Used to map Magento Docker hostnames (e.g. <code>db</code>) to localhost when testing
            from your machine.
          </p>
        </div>
        <div>
          <label className="label">Database host override</label>
          <input
            className="input"
            placeholder="127.0.0.1 (auto from Docker)"
            value={form.databaseHost}
            onChange={(e) => setForm({ ...form, databaseHost: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Database port</label>
          <input
            className="input"
            placeholder="3306"
            value={form.databasePort}
            onChange={(e) => setForm({ ...form, databasePort: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Database name</label>
          <input
            className="input"
            value={form.databaseName}
            onChange={(e) => setForm({ ...form, databaseName: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Database username</label>
          <input
            className="input"
            value={form.databaseUser}
            onChange={(e) => setForm({ ...form, databaseUser: e.target.value })}
          />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Database password</label>
          <input
            className="input"
            type="password"
            placeholder={
              hasDatabasePassword ? '•••••• (leave blank to keep)' : 'Database password'
            }
            value={form.databasePassword}
            onChange={(e) => setForm({ ...form, databasePassword: e.target.value })}
          />
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {health && (
        <div className="rounded-md border border-slate-200 p-3">
          <p className="mb-2 text-sm font-medium">
            Health check{' '}
            <span
              className={
                health.ok ? 'badge bg-green-100 text-green-700' : 'badge bg-red-100 text-red-700'
              }
            >
              {health.ok ? 'ready' : 'issues'}
            </span>
          </p>
          <ul className="space-y-1 text-sm">
            {health.checks.map((c) => (
              <li key={c.key} className="flex items-center gap-2">
                <span className={c.ok ? 'text-green-600' : 'text-red-600'}>
                  {c.ok ? '✓' : '✗'}
                </span>
                <span>{c.label}</span>
                {c.detail && <span className="text-xs text-slate-400">— {c.detail}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          className="btn-secondary"
          disabled={detectDbMutation.isPending || !form.projectRoot}
          onClick={() => detectDbMutation.mutate()}
        >
          {detectDbMutation.isPending ? 'Detecting…' : 'Detect from project'}
        </button>
        <button
          className="btn-secondary"
          disabled={testMutation.isPending || !form.projectRoot}
          onClick={() => testMutation.mutate()}
        >
          {testMutation.isPending ? 'Testing…' : 'Test Connection'}
        </button>
        <button
          className="btn-primary"
          disabled={saveMutation.isPending || !form.projectRoot}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? 'Saving…' : 'Save'}
        </button>
        {saved && <span className="self-center text-sm text-green-600">Saved ✓</span>}
      </div>
    </div>
  );
}
