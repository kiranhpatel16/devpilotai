import type { JiraIssueDetail } from '@cpwork/shared';
import { taskBody, taskMuted, taskPanel, taskPanelHeader, taskSurface, taskTitle } from './taskStyles';

interface TaskDetailsPanelProps {
  issue: JiraIssueDetail | null;
  customTitle?: string;
  customRequirements?: string;
  createdBy?: string | null;
  createdAt?: string | null;
  expanded?: boolean;
}

export function TaskDetailsPanel({
  issue,
  customTitle,
  customRequirements,
  createdBy,
  createdAt,
  expanded,
}: TaskDetailsPanelProps) {
  const description =
    issue?.description?.trim() ||
    customRequirements?.trim() ||
    customTitle ||
    '(no description)';
  const labels = issue?.labels ?? [];

  return (
    <div className={taskPanel}>
      <header className={taskPanelHeader}>
        <h3 className={taskTitle}>Requirements</h3>
      </header>
      <div className="space-y-3 p-4">
        <div
          className={[
            `${taskSurface} px-3 py-3 text-sm ${taskBody} whitespace-pre-wrap`,
            expanded ? 'max-h-none' : 'max-h-48 overflow-y-auto',
          ].join(' ')}
        >
          {description}
        </div>
        {labels.length > 0 && (
          <div>
            <p className={`mb-1.5 text-xs font-medium uppercase tracking-wide ${taskMuted}`}>
              Labels
            </p>
            <div className="flex flex-wrap gap-1.5">
              {labels.map((label) => (
                <span
                  key={label}
                  className="rounded-full bg-brand-600/20 px-2.5 py-0.5 text-xs font-medium text-brand-300"
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        )}
        {(createdBy || createdAt) && (
          <p className={`text-xs ${taskMuted}`}>
            {createdBy && <>Created by {createdBy}</>}
            {createdBy && createdAt && ' • '}
            {createdAt && formatWhen(createdAt)}
          </p>
        )}
      </div>
    </div>
  );
}

function formatWhen(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}
