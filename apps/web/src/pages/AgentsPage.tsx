import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AGENT_DEFINITIONS } from '../components/layout/navConfig';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { api } from '../lib/api';
import type { DashboardSummary } from './DashboardPage';

export function AgentsPage() {
  const agentsQ = useQuery({
    queryKey: ['agents', 'status'],
    queryFn: async () =>
      (await api.get<{ agents: { id: string; label: string; status: string; task: string | null }[] }>(
        '/agents/status',
      )).data.agents,
  });

  const agents = agentsQ.data ?? AGENT_DEFINITIONS.map((a) => ({
    id: a.id,
    label: a.label,
    status: 'online',
    task: null,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        subtitle="AI engineering agents that power DevPilot workflows"
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {agents.map((a) => (
          <div key={a.id} className="card border-surface-700 bg-surface-800/80 p-5">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-white">{a.label}</h3>
              <StatusBadge
                label={a.status === 'online' ? 'Online' : a.status}
                variant={a.status === 'online' ? 'online' : 'busy'}
                dot
              />
            </div>
            <p className="mt-2 text-sm text-slate-500">
              {a.task ?? 'Ready — waiting for task assignment'}
            </p>
          </div>
        ))}
      </div>

      <p className="text-sm text-slate-500">
        Agent orchestration and live task assignment will appear here as workflows run.{' '}
        <Link to="/workspaces" className="text-brand-400 hover:underline">
          Open a workspace
        </Link>{' '}
        to start a task.
      </p>
    </div>
  );
}
