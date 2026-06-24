import type { Activity } from '@cpwork/shared';
import { Bot, Code2, FileText, GitBranch } from 'lucide-react';

export interface ActivityItem {
  id: string;
  icon: 'branch' | 'plan' | 'code' | 'agent';
  text: string;
  time: string;
}

interface ActivityFeedProps {
  items: ActivityItem[];
}

const ICONS = {
  branch: GitBranch,
  plan: FileText,
  code: Code2,
  agent: Bot,
};

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'Just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}

function iconForAction(action: string): ActivityItem['icon'] {
  if (action.includes('branch') || action.includes('commit') || action.includes('push')) return 'branch';
  if (action.includes('plan')) return 'plan';
  if (action.includes('agent') || action.includes('workflow')) return 'agent';
  return 'code';
}

export function mapActivities(activities: Activity[]): ActivityItem[] {
  return activities.map((a) => ({
    id: a.id,
    icon: iconForAction(a.action),
    text: a.summary,
    time: formatWhen(a.createdAt),
  }));
}

export function ActivityFeed({ items }: ActivityFeedProps) {
  if (items.length === 0) {
    return (
      <div className="px-4 py-3">
        <p className="text-xs text-slate-500">Activity will appear as agents work.</p>
      </div>
    );
  }

  return (
    <ul className="max-h-64 space-y-0 overflow-y-auto px-3 py-2">
      {items.map((item, i) => {
        const Icon = ICONS[item.icon];
        return (
          <li key={item.id} className="relative flex gap-3 pb-4 pl-1">
            {i < items.length - 1 && (
              <span className="absolute left-[11px] top-6 h-full w-px bg-slate-200" />
            )}
            <div className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
              <Icon className="h-3 w-3" />
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-xs text-slate-300">{item.text}</p>
              <p className="text-[10px] text-slate-500">{item.time}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function buildActivityFeed(
  step: string | undefined,
  logs: string[],
): ActivityItem[] {
  const items: ActivityItem[] = [];
  if (step) {
    items.push({
      id: 'step',
      icon: 'agent',
      text: `Workflow at step: ${step.replace(/_/g, ' ')}`,
      time: 'Now',
    });
  }
  logs.slice(-5).forEach((log, i) => {
    items.push({
      id: `log-${i}`,
      icon: log.includes('branch') ? 'branch' : log.includes('plan') ? 'plan' : 'code',
      text: log,
      time: 'Recent',
    });
  });
  return items;
}
