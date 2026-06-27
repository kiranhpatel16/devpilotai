import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ProjectAiRulesEditable, ProjectAiRulesSummary } from '@cpwork/shared';
import { api, getApiErrorMessage } from '../../lib/api';
import { ConfirmDeleteModal } from '../../components/ConfirmDeleteModal';

type RuleKey = keyof ProjectAiRulesEditable;

const RULE_LABELS: Record<RuleKey, { title: string; hint: string }> = {
  implementationQualityRules: {
    title: 'Implementation quality rules',
    hint: 'Mandatory code quality constraints enforced on agent output (PHPUnit, no stubs, etc.).',
  },
  magentoRules: {
    title: 'Magento / platform rules',
    hint: 'System prompt for Magento, Hyva, and project conventions. Use {IMPLEMENTATION_QUALITY_RULES} to embed the block above.',
  },
  agentOutputContract: {
    title: 'Agent output contract',
    hint: 'JSON response shape and edit rules for agent/deploy_fix modes.',
  },
};

export function AdminAiRulesPage() {
  const qc = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState(searchParams.get('project') ?? '');
  const [form, setForm] = useState<ProjectAiRulesEditable | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProjectAiRulesSummary | null>(null);

  const listQ = useQuery({
    queryKey: ['admin', 'ai-rules'],
    queryFn: async () =>
      (await api.get<{ projects: ProjectAiRulesSummary[] }>('/admin/ai-rules')).data.projects,
  });

  const rulesQ = useQuery({
    queryKey: ['admin', 'ai-rules', selectedId],
    queryFn: async () =>
      (
        await api.get<{
          project: { id: string; name: string; slug: string };
          hasCustomAiRules: boolean;
          usingDefaults: boolean;
          rules: ProjectAiRulesEditable;
          defaults: ProjectAiRulesEditable;
        }>(`/admin/ai-rules/${selectedId}`)
      ).data,
    enabled: !!selectedId,
  });

  useEffect(() => {
    if (rulesQ.data && !dirty) {
      setForm(rulesQ.data.rules);
    }
  }, [rulesQ.data, dirty]);

  useEffect(() => {
    const fromUrl = searchParams.get('project');
    if (fromUrl && fromUrl !== selectedId) {
      setSelectedId(fromUrl);
      setDirty(false);
    }
  }, [searchParams, selectedId]);

  function selectProject(id: string) {
    setSelectedId(id);
    setDirty(false);
    setError(null);
    setSuccess(null);
    setForm(null);
    if (id) {
      setSearchParams({ project: id });
    } else {
      setSearchParams({});
    }
  }

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['admin', 'ai-rules'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'projects'] });
    if (selectedId) {
      void qc.invalidateQueries({ queryKey: ['admin', 'ai-rules', selectedId] });
    }
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedId || !form) return;
      await api.put(`/admin/ai-rules/${selectedId}`, form);
    },
    onMutate: () => {
      setError(null);
      setSuccess(null);
    },
    onSuccess: () => {
      setDirty(false);
      setSuccess('AI rules saved for this project.');
      invalidate();
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const resetMutation = useMutation({
    mutationFn: async (projectId: string) => {
      await api.delete(`/admin/ai-rules/${projectId}`);
    },
    onSuccess: (_data, projectId) => {
      setDeleteTarget(null);
      setDirty(false);
      if (selectedId === projectId) {
        setSuccess('Reset to system defaults. Agents will use built-in rules until you save custom rules.');
        void rulesQ.refetch();
      } else {
        setSuccess('Custom AI rules deleted for this project.');
      }
      invalidate();
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const selected = listQ.data?.find((p) => p.id === selectedId);
  const customProjects = (listQ.data ?? []).filter((p) => p.hasCustomAiRules);
  const usingDefaults = rulesQ.data?.usingDefaults ?? !selected?.hasCustomAiRules;

  function formatUpdatedAt(iso: string | null | undefined): string {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return iso;
    }
  }

  function setRule(key: RuleKey, value: string) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setDirty(true);
    setSuccess(null);
  }

  function loadDefaults() {
    const d = rulesQ.data?.defaults;
    if (!d) return;
    setForm({
      implementationQualityRules: d.implementationQualityRules,
      magentoRules: d.magentoRules,
      agentOutputContract: d.agentOutputContract,
    });
    setDirty(true);
    setSuccess(null);
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">AI Rules</h1>
        <p className="text-sm text-slate-500">
          Configure per-project prompt rules for implementation quality, Magento conventions, and agent
          JSON output. Projects without custom rules use system defaults.
        </p>
      </div>

      <div className="card p-4">
        <label className="label">Project</label>
        <select
          className="input max-w-md"
          value={selectedId}
          onChange={(e) => selectProject(e.target.value)}
        >
          <option value="">Select a project…</option>
          {(listQ.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} {p.hasCustomAiRules ? '(custom rules)' : '(defaults)'}
            </option>
          ))}
        </select>
      </div>

      <div className="card overflow-hidden">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-neutral-700">
          <h2 className="text-sm font-medium text-slate-800 dark:text-slate-200">
            Projects with custom AI rules
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            These workspaces override system defaults for agent prompts.
          </p>
        </div>
        {listQ.isLoading && <p className="p-4 text-sm text-slate-400">Loading…</p>}
        {!listQ.isLoading && customProjects.length === 0 && (
          <p className="p-4 text-sm text-slate-400">
            No projects have custom rules yet. Select a project above, customize the prompts, and
            click Save AI rules.
          </p>
        )}
        {customProjects.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500 dark:bg-neutral-900 dark:text-slate-400">
              <tr>
                <th className="px-4 py-2">Project</th>
                <th className="px-4 py-2">Slug</th>
                <th className="px-4 py-2">Last updated</th>
                <th className="px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
              {customProjects.map((p) => (
                <tr
                  key={p.id}
                  className={p.id === selectedId ? 'bg-brand-50/50 dark:bg-brand-950/20' : undefined}
                >
                  <td className="px-4 py-2 font-medium">
                    {p.name}
                    <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-800 dark:bg-green-900/40 dark:text-green-300">
                      Custom
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-500">{p.slug}</td>
                  <td className="px-4 py-2 text-slate-500">{formatUpdatedAt(p.updatedAt)}</td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        onClick={() => selectProject(p.id)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn-danger text-xs"
                        disabled={resetMutation.isPending}
                        onClick={() => setDeleteTarget(p)}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {error && (
        <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}
      {success && (
        <div className="rounded-md bg-green-50 px-4 py-3 text-sm text-green-800 dark:bg-green-950/40 dark:text-green-300">
          {success}
        </div>
      )}

      {!selectedId && (
        <p className="text-sm text-slate-400">
          Choose a project to view or edit its AI rules. After creating a project, configure rules here
          so agents follow your team&apos;s standards.
        </p>
      )}

      {selectedId && rulesQ.isLoading && (
        <p className="text-sm text-slate-400">Loading rules…</p>
      )}

      {selectedId && form && !rulesQ.isLoading && (
        <>
          <div
            className={[
              'rounded-md px-4 py-3 text-sm',
              usingDefaults
                ? 'border border-amber-200 bg-amber-50 text-amber-900'
                : 'border border-green-200 bg-green-50 text-green-900',
            ].join(' ')}
          >
            {usingDefaults ? (
              <>
                <strong>Using system defaults.</strong> Save customized rules for{' '}
                <span className="font-medium">{selected?.name}</span> to override agent behavior for
                this project.
              </>
            ) : (
              <>
                <strong>Custom rules active</strong> for{' '}
                <span className="font-medium">{selected?.name}</span>. All agent runs for this project
                use these prompts.
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary text-sm" onClick={loadDefaults}>
              Fill from system defaults
            </button>
            {rulesQ.data?.hasCustomAiRules && (
              <button
                type="button"
                className="btn-danger text-sm"
                onClick={() => selected && setDeleteTarget(selected)}
              >
                Delete custom rules (use defaults)
              </button>
            )}
          </div>

          <div className="space-y-4">
            {(Object.keys(RULE_LABELS) as RuleKey[]).map((key) => (
              <section key={key} className="card p-4">
                <h2 className="font-medium">{RULE_LABELS[key].title}</h2>
                <p className="mt-1 text-xs text-slate-500">{RULE_LABELS[key].hint}</p>
                <textarea
                  className="input mt-3 min-h-[200px] w-full resize-y font-mono text-xs leading-relaxed"
                  value={form[key]}
                  onChange={(e) => setRule(key, e.target.value)}
                />
              </section>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="btn-primary"
              disabled={!dirty || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? 'Saving…' : 'Save AI rules'}
            </button>
          </div>
        </>
      )}

      {deleteTarget && (
        <ConfirmDeleteModal
          title={`Delete custom AI rules for "${deleteTarget.name}"?`}
          message="This removes custom rules for this project. Agent runs will use system defaults until you save new rules."
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => resetMutation.mutate(deleteTarget.id)}
        />
      )}
    </div>
  );
}
