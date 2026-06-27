import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { RunDetail, TaskHistoryRow, TaskWorkflowStep } from '@cpwork/shared';
import { api, getApiErrorMessage } from '../../lib/api';
import { customTaskPath } from '../../lib/customTaskRoutes';
import { useAuth } from '../../auth/AuthContext';
import { CreateCustomTaskModal } from './CreateCustomTaskModal';
import {
  getTabForStep,
  type WorkflowTab,
} from '../execution-center/WorkflowTabs';

const WORKFLOW_COLUMNS: { id: WorkflowTab; label: string }[] = [
  { id: 'requirements', label: 'Analysis' },
  { id: 'setup', label: 'Setup' },
  { id: 'plan', label: 'Plan & Approval' },
  { id: 'code', label: 'Code' },
  { id: 'review', label: 'Review' },
  { id: 'build', label: 'Build' },
  { id: 'pr', label: 'PR' },
  { id: 'qa', label: 'QA' },
  { id: 'done', label: 'Done' },
];

const STEP_LABELS: Partial<Record<TaskWorkflowStep, string>> = {
  select: 'Select',
  requirement_analysis: 'Analysis',
  environment_setup: 'Setup',
  architecture_design: 'Architecture',
  development_plan: 'Plan',
  test_cases: 'Test cases',
  pre_dev_approval: 'Approval',
  branch: 'Branch',
  describe: 'Describe',
  plan: 'Plan',
  review_plan: 'Review plan',
  agent: 'Code',
  code_review: 'Code review',
  deploy: 'Build',
  commit: 'PR',
  qa: 'QA',
  jira_comment: 'Jira',
  done: 'Done',
};

function stepBadgeColor(step: TaskWorkflowStep): string {
  if (step === 'done') {
    return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';
  }
  if (['agent', 'deploy', 'commit'].includes(step)) {
    return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
  }
  return 'bg-slate-100 text-slate-600 dark:bg-neutral-800 dark:text-slate-300';
}

function customTaskLabel(row: TaskHistoryRow): string {
  return row.customTitle?.trim() || row.summary?.trim() || 'Untitled custom task';
}

function customTaskId(row: TaskHistoryRow): string {
  return row.customTaskKey?.trim() || `CT-${row.runId.slice(0, 8).toUpperCase()}`;
}

interface WorkspaceCustomTasksPanelProps {
  projectId: string;
  autoOpenCreate?: boolean;
  onCreateModalClose?: () => void;
}

export function WorkspaceCustomTasksPanel({
  projectId,
  autoOpenCreate,
  onCreateModalClose,
}: WorkspaceCustomTasksPanelProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [createOpen, setCreateOpen] = useState(autoOpenCreate ?? false);

  useEffect(() => {
    if (autoOpenCreate) setCreateOpen(true);
  }, [autoOpenCreate]);

  const historyQ = useQuery({
    queryKey: ['workflow-history', projectId],
    queryFn: async () =>
      (await api.get<{ rows: TaskHistoryRow[] }>(`/workflow/history?projectId=${projectId}`))
        .data.rows,
    enabled: !!projectId,
  });

  const openM = useMutation({
    mutationFn: async (runId: string) =>
      (await api.post<{ detail: RunDetail }>(`/workflow/runs/${runId}/restore`)).data.detail,
    onSuccess: (detail) => {
      openCustomTask(detail);
    },
  });

  const customTasks = useMemo(() => {
    const rows = (historyQ.data ?? []).filter((row) => !row.jiraKey);
    if (scope === 'all') return rows;
    const userId = session?.user.id;
    return userId ? rows.filter((row) => row.userId === userId) : rows;
  }, [historyQ.data, scope, session?.user.id]);

  const grouped = useMemo(() => {
    const map = new Map<WorkflowTab, TaskHistoryRow[]>();
    for (const col of WORKFLOW_COLUMNS) {
      map.set(col.id, []);
    }
    for (const row of customTasks) {
      const tab = getTabForStep(row.currentStep);
      map.get(tab)?.push(row);
    }
    return map;
  }, [customTasks]);

  function openCustomTask(detail: RunDetail) {
    navigate(customTaskPath(projectId, detail.run.id), {
      state: { restoredDetail: detail },
    });
  }

  function startCustomTask() {
    setCreateOpen(true);
  }

  return (
    <div className="space-y-4">
      <CreateCustomTaskModal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          onCreateModalClose?.();
        }}
        projectId={projectId}
        onCreated={() => {
          void queryClient.invalidateQueries({ queryKey: ['workflow-history', projectId] });
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Custom tasks</h2>
          <p className="text-sm text-slate-500">
            {customTasks.length} custom task{customTasks.length === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-slate-200 p-0.5 text-xs dark:border-neutral-800">
            <button
              type="button"
              className={[
                'rounded px-3 py-1',
                scope === 'mine' ? 'bg-brand-600 text-white' : 'text-slate-500',
              ].join(' ')}
              onClick={() => setScope('mine')}
            >
              My tasks
            </button>
            <button
              type="button"
              className={[
                'rounded px-3 py-1',
                scope === 'all' ? 'bg-brand-600 text-white' : 'text-slate-500',
              ].join(' ')}
              onClick={() => setScope('all')}
            >
              All
            </button>
          </div>
          <button type="button" className="btn-secondary text-sm" onClick={startCustomTask}>
            + Custom task
          </button>
        </div>
      </div>

      {historyQ.isError && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {getApiErrorMessage(historyQ.error)}
        </div>
      )}

      {openM.isError && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {getApiErrorMessage(openM.error)}
        </div>
      )}

      {historyQ.isLoading && <p className="text-sm text-slate-500">Loading custom tasks…</p>}

      {!historyQ.isLoading && customTasks.length === 0 && (
        <div className="card p-6 text-center text-sm text-slate-500 shadow-card">
          No custom tasks yet. Create one with the button above.
        </div>
      )}

      {customTasks.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {WORKFLOW_COLUMNS.map((column) => {
            const tasks = grouped.get(column.id) ?? [];
            return (
              <div key={column.id} className="card p-4 shadow-card">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {column.label}
                  </h3>
                  <span className="text-xs text-slate-400">{tasks.length}</span>
                </div>
                <div className="space-y-2">
                  {tasks.length === 0 && <p className="text-xs text-slate-500">No tasks</p>}
                  {tasks.map((task) => (
                    <button
                      key={task.runId}
                      type="button"
                      disabled={openM.isPending}
                      onClick={() => openM.mutate(task.runId)}
                      className="w-full rounded-lg border border-slate-200 bg-white p-3 text-left transition-colors hover:border-brand-400 hover:bg-brand-50/50 disabled:opacity-60 dark:border-neutral-800 dark:bg-neutral-900/80 dark:hover:border-brand-500/50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm font-medium text-brand-600 dark:text-brand-400">
                          {customTaskId(task)}
                        </span>
                        <span className={`badge ${stepBadgeColor(task.currentStep)}`}>
                          {STEP_LABELS[task.currentStep] ?? task.currentStep.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">
                        {customTaskLabel(task)}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
