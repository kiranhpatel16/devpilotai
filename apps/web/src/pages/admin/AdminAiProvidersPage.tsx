import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiProviderInfo } from '@cpwork/shared';
import { api, getApiErrorMessage } from '../../lib/api';
import { ConfirmDeleteModal } from '../../components/ConfirmDeleteModal';

interface ProvidersResponse {
  providers: AiProviderInfo[];
}

export function AdminAiProvidersPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [deleting, setDeleting] = useState<AiProviderInfo | null>(null);

  const providersQ = useQuery({
    queryKey: ['admin-ai-providers'],
    queryFn: async () => (await api.get<ProvidersResponse>('/admin/ai-providers')).data.providers,
  });

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['admin-ai-providers'] });
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">AI Providers</h1>
          <p className="text-sm text-slate-500">
            Configure the AI engines available to agents. Keys are encrypted at rest.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setShowCreate(true)}>
          + Add Provider
        </button>
      </div>

      {providersQ.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {providersQ.isError && (
        <p className="text-sm text-red-600">{getApiErrorMessage(providersQ.error)}</p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {providersQ.data?.map((p) => (
          <ProviderCard
            key={p.id}
            provider={p}
            onSaved={invalidate}
            onDelete={p.deletable ?? p.custom ? () => setDeleting(p) : undefined}
          />
        ))}
      </div>

      {showCreate && (
        <AddProviderModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            invalidate();
          }}
        />
      )}

      {deleting && (
        <ConfirmDeleteModal
          title={`Delete provider "${deleting.label}"?`}
          message="This removes the custom provider and its stored API key. Built-in providers cannot be deleted."
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            await api.delete(`/admin/ai-providers/${deleting.id}`);
            setDeleting(null);
            invalidate();
          }}
        />
      )}
    </div>
  );
}

function ProviderCard({
  provider,
  onSaved,
  onDelete,
}: {
  provider: AiProviderInfo;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const [enabled, setEnabled] = useState(provider.enabled);
  const [apiKey, setApiKey] = useState('');
  const [models, setModels] = useState<string[]>(provider.models);
  const [newModel, setNewModel] = useState('');
  const [defaultModel, setDefaultModel] = useState(provider.defaultModel ?? '');
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? '');
  const [keyConfigured, setKeyConfigured] = useState(provider.configured);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testOk, setTestOk] = useState<boolean | null>(null);

  const unavailable = provider.id === 'cursor';
  const canTest = keyConfigured || !!apiKey.trim();

  useEffect(() => {
    setEnabled(provider.enabled);
    setModels(provider.models);
    setDefaultModel(provider.defaultModel ?? '');
    setBaseUrl(provider.baseUrl ?? '');
    setKeyConfigured(provider.configured);
  }, [provider.id, provider.enabled, provider.models, provider.defaultModel, provider.baseUrl, provider.configured]);

  function addModel() {
    const value = newModel.trim();
    if (!value || models.includes(value)) return;
    const next = [...models, value];
    setModels(next);
    if (!defaultModel || !models.includes(defaultModel)) setDefaultModel(value);
    setNewModel('');
  }

  function removeModel(model: string) {
    const next = models.filter((m) => m !== model);
    setModels(next);
    if (defaultModel === model) setDefaultModel(next[0] ?? '');
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { enabled, defaultModel, models };
      if (apiKey.trim()) body.apiKey = apiKey.trim();
      if (baseUrl.trim()) body.baseUrl = baseUrl.trim();
      return (await api.put(`/admin/ai-providers/${provider.id}`, body)).data as ProvidersResponse;
    },
    onSuccess: (data) => {
      const saved = data.providers.find((p) => p.id === provider.id);
      if (saved) {
        setKeyConfigured(saved.configured);
        setEnabled(saved.enabled);
        setModels(saved.models);
        setDefaultModel(saved.defaultModel ?? defaultModel);
        setBaseUrl(saved.baseUrl ?? baseUrl);
      } else if (apiKey.trim()) {
        setKeyConfigured(true);
      }
      setApiKey('');
      setTestResult(null);
      setTestOk(null);
      onSaved();
    },
  });

  const testMutation = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/admin/ai-providers/${provider.id}/test`, {
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
          ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
          ...(defaultModel ? { defaultModel } : {}),
        })
      ).data,
    onMutate: () => {
      setTestResult(null);
      setTestOk(null);
    },
    onSuccess: () => {
      setTestOk(true);
      setTestResult('Connection OK');
    },
    onError: (err) => {
      setTestOk(false);
      setTestResult(getApiErrorMessage(err));
    },
  });

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-slate-800">
            {provider.label}
            {provider.custom && (
              <span className="ml-2 text-xs font-normal text-slate-400">custom</span>
            )}
          </h2>
          <p className="text-xs text-slate-400">
            {keyConfigured ? 'Key configured' : 'No key set'}
            {enabled ? ' · enabled' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onDelete && (
            <button
              type="button"
              className="btn-danger border border-red-200 text-xs"
              onClick={onDelete}
            >
              Delete
            </button>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              disabled={unavailable}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Enabled
          </label>
        </div>
      </div>

      {unavailable ? (
        <p className="rounded-md bg-slate-50 p-2 text-xs text-slate-500">
          Cursor SDK runtime is not wired in this build. Use ChatGPT, Grok, or Cloud AI.
        </p>
      ) : (
        <>
          <div>
            <label className="label">API key {keyConfigured && '(leave blank to keep)'}</label>
            <input
              type="password"
              className="input"
              placeholder={keyConfigured ? '•••••••• stored' : 'Paste API key'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            {keyConfigured && (
              <p className="mt-1 text-xs text-green-700">API key saved for this provider.</p>
            )}
          </div>
          <div>
            <label className="label">Models</label>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {models.map((m) => (
                <span
                  key={m}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-xs text-slate-700"
                >
                  {m}
                  <button
                    type="button"
                    className="text-slate-400 hover:text-red-600"
                    title="Remove model"
                    onClick={() => removeModel(m)}
                    disabled={models.length <= 1}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                className="input font-mono text-xs"
                placeholder="Add model id"
                value={newModel}
                onChange={(e) => setNewModel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addModel();
                  }
                }}
              />
              <button
                type="button"
                className="btn-secondary shrink-0 text-xs"
                disabled={!newModel.trim() || models.includes(newModel.trim())}
                onClick={addModel}
              >
                Add
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Default model</label>
              <select
                className="input"
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Base URL (optional)</label>
              <input
                className="input font-mono text-xs"
                placeholder={provider.defaultBaseUrl ?? 'default'}
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
              {!baseUrl.trim() && provider.defaultBaseUrl && (
                <p className="mt-1 text-xs text-slate-400">
                  Requests use {provider.defaultBaseUrl}
                </p>
              )}
            </div>
          </div>

          {testResult && (
            <p className={`text-xs ${testOk ? 'text-green-600' : 'text-red-600'}`}>{testResult}</p>
          )}
          {saveMutation.isError && (
            <p className="text-xs text-red-600">{getApiErrorMessage(saveMutation.error)}</p>
          )}

          <div className="flex gap-2">
            <button
              className="btn-primary"
              disabled={saveMutation.isPending || models.length === 0 || !defaultModel}
              onClick={() => saveMutation.mutate()}
            >
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </button>
            <button
              className="btn-secondary"
              disabled={testMutation.isPending || !canTest}
              onClick={() => testMutation.mutate()}
              title={
                canTest
                  ? 'Uses the typed key or the saved provider key when the field is blank'
                  : 'Paste an API key or save one first'
              }
            >
              {testMutation.isPending ? 'Testing…' : 'Test connection'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function AddProviderModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState({
    id: '',
    label: '',
    defaultBaseUrl: 'https://api.openai.com/v1',
    modelsText: '',
    defaultModel: '',
    apiKey: '',
    enabled: false,
  });
  const [error, setError] = useState<string | null>(null);

  const models = form.modelsText
    .split(/[\n,]+/)
    .map((m) => m.trim())
    .filter(Boolean);

  const mutation = useMutation({
    mutationFn: async () =>
      api.post('/admin/ai-providers', {
        id: form.id,
        label: form.label,
        defaultBaseUrl: form.defaultBaseUrl || undefined,
        models,
        defaultModel: form.defaultModel || models[0],
        apiKey: form.apiKey || undefined,
        enabled: form.enabled,
      }),
    onSuccess: onCreated,
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg">
        <div className="card">
          <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <h2 className="font-medium">Add AI provider</h2>
            <button className="btn-ghost" onClick={onClose}>
              ✕
            </button>
          </header>
          <div className="space-y-3 p-4">
            <p className="text-xs text-slate-500">
              Custom providers use an OpenAI-compatible API. Enter one model per line or comma-separated.
            </p>
            <div>
              <label className="label">Provider ID (a-z, 0-9, -, _)</label>
              <input
                className="input font-mono"
                placeholder="anthropic"
                value={form.id}
                onChange={(e) => setForm({ ...form, id: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Display name</label>
              <input
                className="input"
                placeholder="Anthropic (Claude)"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Base URL</label>
              <input
                className="input font-mono text-xs"
                value={form.defaultBaseUrl}
                onChange={(e) => setForm({ ...form, defaultBaseUrl: e.target.value })}
              />
            </div>
            <div>
              <label className="label">Models</label>
              <textarea
                className="input min-h-[80px] font-mono text-xs"
                placeholder={'claude-3-5-sonnet\nclaude-3-5-haiku'}
                value={form.modelsText}
                onChange={(e) => setForm({ ...form, modelsText: e.target.value })}
              />
            </div>
            {models.length > 0 && (
              <div>
                <label className="label">Default model</label>
                <select
                  className="input"
                  value={form.defaultModel || models[0]}
                  onChange={(e) => setForm({ ...form, defaultModel: e.target.value })}
                >
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="label">API key (optional now)</label>
              <input
                type="password"
                className="input"
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
              />
              Enable after create
            </label>
            {error && (
              <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
            )}
          </div>
          <footer className="flex justify-end gap-2 border-t border-slate-200 px-4 py-3">
            <button className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn-primary"
              disabled={mutation.isPending || !form.id || !form.label || models.length === 0}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? 'Creating…' : 'Create provider'}
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}
