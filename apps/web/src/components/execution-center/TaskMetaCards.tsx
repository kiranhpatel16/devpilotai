import type { JiraIssueDetail, JiraTask } from '@cpwork/shared';
import { Calendar, Flag, Tag, User } from 'lucide-react';
import { taskBody, taskMuted, taskPanel } from './taskStyles';

interface TaskMetaCardsProps {
  issue: JiraIssueDetail | JiraTask | null;
  jiraKey: string | null;
}

function MetaCard({
  icon: Icon,
  label,
  value,
  valueClass,
}: {
  icon: typeof Flag;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className={`${taskPanel} flex items-center gap-3 p-3`}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600/20 text-brand-400">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className={`text-xs ${taskMuted}`}>{label}</p>
        <p className={`truncate text-sm font-semibold ${valueClass ?? 'text-white'}`}>{value}</p>
      </div>
    </div>
  );
}

function formatUpdated(updated: string | null | undefined): string {
  if (!updated) return '—';
  const d = new Date(updated);
  const diff = Date.now() - d.getTime();
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return d.toLocaleDateString();
}

export function TaskMetaCards({ issue, jiraKey }: TaskMetaCardsProps) {
  if (!issue && !jiraKey) return null;

  const priority = issue?.priority ?? 'Medium';
  const isHigh = priority.toLowerCase().includes('high');

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      <MetaCard icon={Tag} label="Jira Ticket" value={jiraKey ?? issue?.key ?? '—'} />
      <MetaCard
        icon={Flag}
        label="Priority"
        value={priority}
        valueClass={isHigh ? 'text-red-400' : 'text-white'}
      />
      <MetaCard icon={User} label="Assignee" value={issue?.assignee ?? 'Unassigned'} />
      <MetaCard icon={Tag} label="Type" value={issue?.issueType ?? 'Story'} />
      <MetaCard icon={Calendar} label="Updated" value={formatUpdated(issue?.updated)} />
    </div>
  );
}
