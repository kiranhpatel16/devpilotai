import { useQuery } from '@tanstack/react-query';
import { PageHeader } from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';
import { StatusBadge } from '../components/ui/StatusBadge';
import { api } from '../lib/api';

export function DeploymentsPage() {
  const depsQ = useQuery({
    queryKey: ['deployments'],
    queryFn: async () =>
      (await api.get<{ deployments: { id: string; environment: string; status: string; createdAt: string }[] }>(
        '/deployments',
      )).data.deployments,
  });

  const deps = depsQ.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deployments"
        subtitle="Staging and production deployment history"
      />

      <div className="flex gap-2">
        <StatusBadge label="Staging" variant="online" dot />
        <StatusBadge label="Production" variant="default" />
      </div>

      {deps.length === 0 ? (
        <EmptyState
          title="No recent deployments"
          description="Deployments from workflow runs will appear here with build status, logs, and rollback options."
        />
      ) : (
        <ul className="space-y-2">
          {deps.map((d) => (
            <li key={d.id} className="card border-surface-700 bg-surface-800/80 p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium text-white capitalize">{d.environment}</span>
                <StatusBadge
                  label={d.status}
                  variant={d.status === 'success' ? 'online' : 'busy'}
                />
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {new Date(d.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
