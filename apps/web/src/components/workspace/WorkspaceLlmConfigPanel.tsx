import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiProviderInfo, Project, ProjectLlmConfig } from '@cpwork/shared';
import { Loader2, Sparkles } from 'lucide-react';
import { api, getApiErrorMessage } from '../../lib/api';

function defaultLlmConfig(): ProjectLlmConfig {
  return {
    provider: null,
    model: null,
    planningProvider: null,
    planningModel: null,
    codingProvider: null,
    codingModel: null,
    maxTokens: 16384,
    temperature: 0.2,
    topP: null,
    jsonMode: true,
    maxRetries: null,
  };
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      {hint ? <p className="mb-1.5 text-xs text-slate-500">{hint}</p> : null}
      {children}
    </div>
  );
}

interface WorkspaceLlmConfigPanelProps {
  projectId: string;
  project: Project | undefined;
}

export function WorkspaceLlmConfigPanel({ projectId, project }: WorkspaceLlmConfigPanelProps) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ProjectLlmConfig>(defaultLlmConfig());
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const providersQ = useQuery({
    queryKey: ['ai-providers'],
    queryFn: async () =>
      (await api.get<{ providers: AiProviderInfo[] }>('/ai/providers')).data.providers,
  });

  const providers = providersQ.data ?? [];

  useEffect(() => {
    if (!project) return;
    setForm({ ...defaultLlmConfig(), ...project.llmConfig });
  }, [project?.id, project?.updatedAt]);

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === form.provider),
    [providers, form.provider],
  );

  const saveM = useMutation({
    mutationFn: async () => {
      const payload: Partial<ProjectLlmConfig> = {
        provider: form.provider || null,
        model: form.model?.trim() || null,
        maxTokens: form.maxTokens,
        temperature: form.temperature,
        topP: form.topP,
        jsonMode: form.jsonMode,
        maxRetries: form.maxRetries,
      };
      return (
        await api.put<{ project: Project }>(`/projects/${projectId}/llm-config`, payload)
      ).data;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(['project', projectId], (prev: { project: Project } | undefined) =>
        prev ? { ...prev, project: data.project } : prev,
      );
      setSavedMsg('LLM configuration saved.');
      setErrorMsg(null);
      setTimeout(() => setSavedMsg(null), 4000);
    },
    onError: (err) => setErrorMsg(getApiErrorMessage(err)),
  });

  function update<K extends keyof ProjectLlmConfig>(key: K, value: ProjectLlmConfig[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSavedMsg(null);
    setErrorMsg(null);
  }

  return (
    <div className="space-y-6">
      <div className="card space-y-2 p-6 shadow-card">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-brand-600 dark:text-brand-400" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">LLM configuration</h2>
        </div>
        <p className="text-sm text-slate-500">
          Default AI model settings for this workspace. New tasks use these values unless overridden
          during setup.
        </p>
      </div>

      <section className="card space-y-5 p-6 shadow-card">
        <Field
          label="AI provider"
          hint="Must be enabled in Admin → AI Providers. API keys are configured there."
        >
          <select
            className="input"
            value={form.provider ?? ''}
            onChange={(e) => {
              const nextProvider = e.target.value || null;
              const info = providers.find((p) => p.id === nextProvider);
              setForm((prev) => ({
                ...prev,
                provider: nextProvider,
                model: info?.defaultModel ?? prev.model,
              }));
              setSavedMsg(null);
              setErrorMsg(null);
            }}
            disabled={providersQ.isLoading}
          >
            <option value="">System default (first enabled provider)</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Model"
          hint={
            selectedProvider?.defaultModel
              ? `Provider default: ${selectedProvider.defaultModel}`
              : 'Leave blank to use the provider default model.'
          }
        >
          <input
            className="input"
            value={form.model ?? ''}
            placeholder={selectedProvider?.defaultModel ?? 'e.g. gpt-4o-mini'}
            onChange={(e) => update('model', e.target.value || null)}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Max output tokens" hint="Caps response length per AI call.">
            <input
              className="input"
              type="number"
              min={256}
              max={128000}
              step={256}
              value={form.maxTokens ?? ''}
              onChange={(e) =>
                update('maxTokens', e.target.value ? Number(e.target.value) : null)
              }
            />
          </Field>

          <Field label="Temperature" hint="0 = deterministic, 2 = more creative.">
            <input
              className="input"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={form.temperature ?? ''}
              onChange={(e) =>
                update('temperature', e.target.value ? Number(e.target.value) : null)
              }
            />
          </Field>

          <Field label="Top P (optional)" hint="Nucleus sampling; leave empty for provider default.">
            <input
              className="input"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={form.topP ?? ''}
              placeholder="Default"
              onChange={(e) => update('topP', e.target.value ? Number(e.target.value) : null)}
            />
          </Field>

          <Field label="Max agent retries" hint="Validation retry limit for code generation.">
            <input
              className="input"
              type="number"
              min={0}
              max={10}
              step={1}
              value={form.maxRetries ?? ''}
              placeholder="System default (5)"
              onChange={(e) =>
                update('maxRetries', e.target.value ? Number(e.target.value) : null)
              }
            />
          </Field>
        </div>

        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="mt-1"
            checked={form.jsonMode}
            onChange={(e) => update('jsonMode', e.target.checked)}
          />
          <span>
            <span className="block text-sm font-medium text-slate-800 dark:text-slate-200">
              JSON mode for agent steps
            </span>
            <span className="text-xs text-slate-500">
              Request structured JSON responses when the workflow expects machine-readable output.
            </span>
          </span>
        </label>

        {errorMsg ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
            {errorMsg}
          </p>
        ) : null}
        {savedMsg ? (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
            {savedMsg}
          </p>
        ) : null}

        <div className="flex justify-end pt-2">
          <button
            type="button"
            className="btn-primary inline-flex items-center gap-2"
            disabled={saveM.isPending}
            onClick={() => saveM.mutate()}
          >
            {saveM.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save LLM configuration
          </button>
        </div>
      </section>
    </div>
  );
}
