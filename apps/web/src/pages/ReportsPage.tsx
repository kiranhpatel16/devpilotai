import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/ui/PageHeader';
import { MetricSparkCard } from '../components/dashboard/MetricSparkCard';
import { api } from '../lib/api';

interface ReportsSummary {
  tasksCompleted: number;
  aiGeneratedPrs: number;
  hoursSaved: number;
  bugsPrevented: number;
  deployments: number;
}

export function ReportsPage() {
  const reportsQ = useQuery({
    queryKey: ['reports', 'summary'],
    queryFn: async () => (await api.get<ReportsSummary>('/reports/summary')).data,
  });

  const p = reportsQ.data;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        subtitle="Monthly productivity and AI impact metrics"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricSparkCard label="Tasks Completed" value={p?.tasksCompleted ?? '—'} />
        <MetricSparkCard label="AI Generated PRs" value={p?.aiGeneratedPrs ?? '—'} color="#f59e0b" />
        <MetricSparkCard label="Hours Saved" value={p?.hoursSaved ?? '—'} color="#22c55e" />
        <MetricSparkCard label="Bugs Prevented" value={p?.bugsPrevented ?? '—'} color="#14b8a6" />
      </div>

      <div className="card border-surface-700 bg-surface-800/80 p-6">
        <h3 className="font-medium text-white">Monthly Summary</h3>
        <p className="mt-2 text-sm text-slate-500">
          Full reporting with bugs prevented, deployments, and per-project breakdowns will be
          available as more workflow data is collected.
        </p>
      </div>
    </div>
  );
}
