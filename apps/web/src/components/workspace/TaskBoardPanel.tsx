import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { JiraBoard, JiraStatusGroup, JiraTask } from '@cpwork/shared';
import { CreateCustomTaskModal } from './CreateCustomTaskModal';

function mergeStatusGroups(groups: JiraStatusGroup[]): JiraStatusGroup[] {
  const merged = new Map<string, JiraStatusGroup>();
  for (const group of groups) {
    const key = group.status.trim().toLowerCase();
    const existing = merged.get(key);
    if (existing) {
      existing.tasks.push(...group.tasks);
    } else {
      merged.set(key, { status: group.status, tasks: [...group.tasks] });
    }
  }
  return Array.from(merged.values());
}

function statusColor(category: string): string {
  switch (category) {
    case 'Done':
      return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';
    case 'In Progress':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
    default:
      return 'bg-slate-100 text-slate-600 dark:bg-neutral-800 dark:text-slate-300';
  }
}

interface TaskBoardPanelProps {
  projectId: string;
  board: JiraBoard | undefined;
  boardLoading: boolean;
  boardError: string | null;
  scope: 'mine' | 'all';
  onScopeChange: (s: 'mine' | 'all') => void;
  onDetectJira: () => void;
  needsJiraIdentity?: boolean;
  jiraMessage?: string;
}

export function TaskBoardPanel({
  projectId,
  board,
  boardLoading,
  boardError,
  scope,
  onScopeChange,
  onDetectJira,
  needsJiraIdentity,
  jiraMessage,
}: TaskBoardPanelProps) {
  const navigate = useNavigate();
  const [createOpen, setCreateOpen] = useState(false);

  function openTask(task: JiraTask) {
    navigate(`/workspaces/${projectId}/tasks/${encodeURIComponent(task.key)}`);
  }

  function startCustomTask() {
    setCreateOpen(true);
  }

  return (
    <div className="space-y-4">
      <CreateCustomTaskModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        projectId={projectId}
        onCreated={() => {
          navigate(`/workspaces/${projectId}?tab=custom`);
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Jira tasks</h2>
          {board?.configured && (
            <p className="text-sm text-slate-500">{board.total} open tasks</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-slate-200 p-0.5 text-xs dark:border-neutral-800">
            <button
              type="button"
              className={[
                'rounded px-3 py-1',
                scope === 'mine' ? 'bg-brand-600 text-white' : 'text-slate-500',
              ].join(' ')}
              onClick={() => onScopeChange('mine')}
            >
              My tasks
            </button>
            <button
              type="button"
              className={[
                'rounded px-3 py-1',
                scope === 'all' ? 'bg-brand-600 text-white' : 'text-slate-500',
              ].join(' ')}
              onClick={() => onScopeChange('all')}
            >
              All
            </button>
          </div>
          <button type="button" className="btn-secondary text-sm" onClick={startCustomTask}>
            + Custom task
          </button>
        </div>
      </div>

      {boardLoading && <p className="text-sm text-slate-500">Loading tasks…</p>}
      {boardError && <p className="text-sm text-red-500">{boardError}</p>}

      {needsJiraIdentity && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <p className="font-medium">Jira account needed</p>
          <p className="mt-1">{jiraMessage}</p>
          <button type="button" className="btn-secondary mt-2 text-xs" onClick={onDetectJira}>
            Detect from Jira
          </button>
        </div>
      )}

      {board && !board.configured && (
        <p className="text-sm text-amber-700 dark:text-amber-300">{board.message}</p>
      )}

      {board?.configured && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {mergeStatusGroups(board.groups).map((group) => (
            <div key={group.status.toLowerCase()} className="card p-4 shadow-card">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  {group.status}
                </h3>
                <span className="text-xs text-slate-400">{group.tasks.length}</span>
              </div>
              <div className="space-y-2">
                {group.tasks.length === 0 && (
                  <p className="text-xs text-slate-500">No tasks</p>
                )}
                {group.tasks.map((task) => (
                  <button
                    key={task.key}
                    type="button"
                    onClick={() => openTask(task)}
                    className="w-full rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-brand-400 hover:bg-brand-50/50 dark:border-neutral-800 dark:bg-neutral-900/80 dark:hover:border-brand-500/50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm font-medium text-brand-600 dark:text-brand-400">
                        {task.key}
                      </span>
                      <span className={`badge ${statusColor(task.statusCategory)}`}>
                        {task.status}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">
                      {task.summary}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
