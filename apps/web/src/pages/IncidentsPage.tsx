import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/ui/PageHeader';
import { api, getApiErrorMessage } from '../lib/api';
import type { ProjectListItem } from '../lib/projects';

export function IncidentsPage() {
  const [projectId, setProjectId] = useState('');
  const [logs, setLogs] = useState('');
  const [reportId, setReportId] = useState('');

  const projectsQ = useQuery({
    queryKey: ['projects'],
    queryFn: async () =>
      (await api.get<{ projects: ProjectListItem[] }>('/projects')).data.projects,
  });

  const analyzeM = useMutation({
    mutationFn: async () => {
      const pid = projectId || projectsQ.data?.[0]?.id;
      if (!pid) throw new Error('Select a workspace');
      return (
        await api.post<{
          rootCause: string;
          analysis: string;
          suggestedFix: string | null;
          files: string[];
        }>(`/projects/${pid}/incidents/analyze`, { logs, reportId: reportId || null })
      ).data;
    },
  });

  const projects = projectsQ.data ?? [];
  const selected = projectId || projects[0]?.id || '';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Production Issues"
        subtitle="Incident response — paste logs for root cause analysis"
      />

      <div className="card space-y-4 border-surface-700 bg-surface-800/80 p-4">
        <div>
          <label className="label text-slate-300" htmlFor="incident-project">
            Workspace
          </label>
          <select
            id="incident-project"
            className="input border-surface-700 bg-surface-900"
            value={selected}
            onChange={(e) => setProjectId(e.target.value)}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label text-slate-300" htmlFor="report-id">
            Report ID (optional)
          </label>
          <input
            id="report-id"
            className="input border-surface-700 bg-surface-900"
            value={reportId}
            onChange={(e) => setReportId(e.target.value)}
            placeholder="Magento report ID"
          />
        </div>
        <div>
          <label className="label text-slate-300" htmlFor="incident-logs">
            Logs
          </label>
          <textarea
            id="incident-logs"
            className="input min-h-[160px] border-surface-700 bg-surface-900 font-mono text-xs"
            value={logs}
            onChange={(e) => setLogs(e.target.value)}
            placeholder="Paste exception.log or system.log content…"
          />
        </div>
        <button
          type="button"
          className="btn-primary"
          disabled={!logs.trim() || analyzeM.isPending}
          onClick={() => analyzeM.mutate()}
        >
          {analyzeM.isPending ? 'Analyzing…' : 'Analyze Incident'}
        </button>
        {analyzeM.isError && (
          <p className="text-sm text-red-400">{getApiErrorMessage(analyzeM.error)}</p>
        )}
      </div>

      {analyzeM.data && (
        <div className="card space-y-3 border-surface-700 bg-surface-800/80 p-4">
          <h3 className="font-medium text-white">Root Cause</h3>
          <p className="text-sm text-slate-300">{analyzeM.data.rootCause}</p>
          <h3 className="font-medium text-white">Analysis</h3>
          <pre className="whitespace-pre-wrap text-xs text-slate-400">{analyzeM.data.analysis}</pre>
          {analyzeM.data.files.length > 0 && (
            <>
              <h3 className="font-medium text-white">Files to Update</h3>
              <ul className="list-inside list-disc text-sm text-slate-400">
                {analyzeM.data.files.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
