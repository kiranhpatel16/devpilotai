import { StatusBadge } from '../ui/StatusBadge';

interface AgentStatusListProps {
  agents: { id: string; label: string; status: string; task: string | null }[];
}

export function AgentStatusList({ agents }: AgentStatusListProps) {
  return (
    <div className="card p-4">
      <h3 className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">
        Agent Status
      </h3>
      <ul className="space-y-2">
        {agents.map((a) => (
          <li
            key={a.id}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-neutral-800 dark:bg-black"
          >
            <span className="text-sm text-slate-800 dark:text-slate-200">{a.label}</span>
            <StatusBadge
              label={a.status === 'online' ? 'Online' : a.status}
              variant={a.status === 'online' ? 'online' : a.status === 'busy' ? 'busy' : 'offline'}
              dot
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
