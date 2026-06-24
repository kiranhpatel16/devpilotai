import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { Activity, JiraTask } from '@cpwork/shared';
import { api } from '../lib/api';
import { PageHeader } from '../components/ui/PageHeader';
import { MetricSparkCard } from '../components/dashboard/MetricSparkCard';
import { TaskStatusDonut } from '../components/dashboard/TaskStatusDonut';
import { PipelineFunnel } from '../components/dashboard/PipelineFunnel';
import { SectionCard } from '../components/ui/SectionCard';
import { app, chartPalette } from '../theme/tokens';

export interface DashboardSummary {
  taskCounts: {
    open: number;
    inProgress: number;
    codeReview: number;
    prReady: number;
    deployReady: number;
    blocked: number;
    done: number;
  };
  totalTasks: number;
  tasksByProject: { projectId: string; projectName: string; count: number }[];
  recentTasks: JiraTask[];
  productivity: {
    aiCompleted: number;
    prReady: number;
    filesModified: number;
    testsGenerated: number;
    hoursSaved: number;
    aiCreditsUsed: number;
    aiCreditsLimit: number;
  };
  pipeline: Record<string, number>;
  activities: Activity[];
}

export function DashboardPage() {
  const summaryQ = useQuery({
    queryKey: ['dashboard', 'summary'],
    queryFn: async () =>
      (await api.get<DashboardSummary>('/dashboard/summary')).data,
    refetchInterval: 60_000,
  });

  const s = summaryQ.data;
  const tc = s?.taskCounts;

  const statusDonut = [
    { name: 'To Do', value: tc?.open ?? 0, color: chartPalette[0] },
    { name: 'In Progress', value: tc?.inProgress ?? 0, color: chartPalette[1] },
    { name: 'Code Review', value: tc?.codeReview ?? 0, color: chartPalette[2] },
    { name: 'PR Ready', value: tc?.prReady ?? 0, color: chartPalette[3] },
    { name: 'Testing', value: tc?.deployReady ?? 0, color: chartPalette[4] },
    { name: 'Deployed', value: tc?.done ?? 0, color: chartPalette[5] },
    { name: 'Blocked', value: tc?.blocked ?? 0, color: chartPalette[6] },
  ];

  const projectDonut = (s?.tasksByProject ?? []).map((p, i) => ({
    name: p.projectName,
    value: p.count,
    color: chartPalette[i % chartPalette.length],
  }));

  const pipelineStages = [
    { label: 'To Do', count: s?.pipeline.todo ?? 0, color: chartPalette[0] },
    { label: 'In Progress', count: s?.pipeline.inProgress ?? 0, color: chartPalette[1] },
    { label: 'Review', count: s?.pipeline.codeReview ?? 0, color: chartPalette[2] },
    { label: 'PR Ready', count: s?.pipeline.prReady ?? 0, color: chartPalette[3] },
    { label: 'Testing', count: s?.pipeline.testing ?? 0, color: chartPalette[4] },
    { label: 'Deployed', count: s?.pipeline.deployed ?? 0, color: chartPalette[5] },
    { label: 'Blocked', count: s?.pipeline.blocked ?? 0, color: chartPalette[6] },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Command Center"
        subtitle="DevPilot AI engineering platform overview"
      />

      {summaryQ.isLoading && (
        <p className="text-sm text-slate-500">Loading dashboard…</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <MetricSparkCard label="Open Tasks" value={tc?.open ?? '—'} delta="+12%" color={app.accent} />
        <MetricSparkCard
          label="In Progress"
          value={tc?.inProgress ?? '—'}
          delta="+16%"
          color="#06B6D4"
        />
        <MetricSparkCard
          label="PR Ready"
          value={s?.productivity.prReady ?? tc?.prReady ?? '—'}
          delta="+25%"
          color="#F59E0B"
        />
        <MetricSparkCard
          label="Deployed"
          value={tc?.done ?? '—'}
          delta="+100%"
          color="#10B981"
        />
        <MetricSparkCard
          label="Blocked"
          value={tc?.blocked ?? '—'}
          delta="-50%"
          deltaPositive={false}
          color="#EF4444"
        />
        <MetricSparkCard
          label="Hours Saved"
          value={s?.productivity.hoursSaved ?? '—'}
          delta="+18%"
          color={app.accentLight}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <TaskStatusDonut data={statusDonut} total={s?.totalTasks} />
        <TaskStatusDonut
          data={projectDonut.length ? projectDonut : [{ name: 'No projects', value: 1, color: app.mutedLight }]}
          title="Tasks by Project"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard title="Recent Activity" className="lg:col-span-1">
          <ul className="space-y-3 text-sm">
            {(s?.activities ?? []).length === 0 && (
              <li className="text-slate-500">No recent activity.</li>
            )}
            {(s?.activities ?? []).slice(0, 6).map((a) => (
              <li key={a.id} className="border-b border-slate-200 pb-2 last:border-0 dark:border-slate-700">
                <p className="text-slate-800 dark:text-slate-200">{a.summary}</p>
                <p className="text-xs text-slate-500">
                  {a.username ?? 'System'} · {new Date(a.createdAt).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </SectionCard>

        <SectionCard title="Recent Tasks" className="lg:col-span-2">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="pb-2 pr-4">Key</th>
                  <th className="pb-2 pr-4">Summary</th>
                  <th className="pb-2 pr-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {(s?.recentTasks ?? []).map((t) => (
                  <tr key={t.key} className="border-t border-slate-200 dark:border-slate-700">
                    <td className="py-2 pr-4 font-mono text-brand-600 dark:text-brand-400">{t.key}</td>
                    <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">{t.summary}</td>
                    <td className="py-2">
                      <span className="badge bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">{t.status}</span>
                    </td>
                  </tr>
                ))}
                {(s?.recentTasks ?? []).length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-4 text-slate-500">
                      No Jira tasks loaded. Configure Jira on your workspaces.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      <PipelineFunnel stages={pipelineStages} />

      <div className="flex justify-end">
        <Link to="/workspaces" className="btn-primary">
          Open Workspace →
        </Link>
      </div>
    </div>
  );
}
