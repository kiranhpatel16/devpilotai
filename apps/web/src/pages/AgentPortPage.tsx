import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AiProviderInfo,
  JiraBoard,
  JiraIssueDetail,
  JiraTask,
  Project,
  RunDetail,
  TaskHistoryRow,
  TaskWorkflowStep,
  UserProjectEnvironment,
} from '@cpwork/shared';
import { api, getApiErrorCode, getApiErrorMessage } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { TaskStepper } from '../components/task-workflow/TaskStepper';
import { TaskHistoryGrid } from '../components/task-workflow/TaskHistoryGrid';
import { WorkflowStepContent } from '../components/task-workflow/WorkflowStepContent';
import { SelectedJiraTaskCard } from '../components/task-workflow/SelectedJiraTaskCard';

interface ProjectDetail {
  project: Project;
  myRole: string | null;
  myEnvironment: UserProjectEnvironment | null;
}

function statusColor(category: string): string {
  switch (category) {
    case 'Done':
      return 'bg-green-100 text-green-700';
    case 'In Progress':
      return 'bg-blue-100 text-blue-700';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

export function AgentPortPage() {
  const { projectId = '' } = useParams();
  const queryClient = useQueryClient();
  const { refresh } = useAuth();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);
  const [customTitle, setCustomTitle] = useState('');
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [showHistory, setShowHistory] = useState(false);
  const [historyJiraKey, setHistoryJiraKey] = useState<string | null>(null);

  const providersQ = useQuery({
    queryKey: ['ai-providers'],
    queryFn: async () =>
      (await api.get<{ providers: AiProviderInfo[] }>('/ai/providers')).data.providers,
  });

  const projectQ = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => (await api.get<ProjectDetail>(`/projects/${projectId}`)).data,
    enabled: !!projectId,
  });

  const boardQ = useQuery({
    queryKey: ['jira-board', projectId, scope],
    queryFn: async () =>
      (
        await api.get<{ board: JiraBoard }>(
          `/projects/${projectId}/jira/tasks?scope=${scope}`,
        )
      ).data.board,
    enabled: !!projectId,
  });

  const historyQ = useQuery({
    queryKey: ['workflow-history', projectId],
    queryFn: async () =>
      (await api.get<{ rows: TaskHistoryRow[] }>(`/workflow/history?projectId=${projectId}`))
        .data.rows,
    enabled: !!projectId && showHistory,
  });

  const selectedIssueQ = useQuery({
    queryKey: ['jira-issue', projectId, selectedKey],
    queryFn: async () =>
      (
        await api.get<{ issue: JiraIssueDetail }>(
          `/projects/${projectId}/jira/issues/${selectedKey}`,
        )
      ).data.issue,
    enabled: !!projectId && !!selectedKey && !custom,
  });

  const startWorkflowM = useMutation({
    mutationFn: async (input: { jiraKey?: string | null; customTitle?: string }) =>
      (
        await api.post<{ detail: RunDetail }>('/workflow/runs', {
          projectId,
          jiraKey: input.jiraKey ?? null,
          customTitle: input.customTitle ?? null,
        })
      ).data.detail,
    onMutate: () => setError(null),
    onSuccess: (d) => {
      setDetail(d);
      setShowHistory(false);
    },
    onError: (err) =>
      setError({ message: getApiErrorMessage(err), code: getApiErrorCode(err) }),
  });

  const navigateStepM = useMutation({
    mutationFn: async (step: TaskWorkflowStep) => {
      if (!detail) throw new Error('No active run');
      return (
        await api.patch<{ detail: RunDetail }>(`/workflow/runs/${detail.run.id}/step`, {
          step,
        })
      ).data.detail;
    },
    onSuccess: (d) => setDetail(d),
    onError: (err) => setError({ message: getApiErrorMessage(err) }),
  });

  function selectTask(task: JiraTask) {
    setCustom(false);
    setSelectedKey(task.key);
    setDetail(null);
    setError(null);
    setShowHistory(false);
  }

  function startCustomTask() {
    setSelectedKey(null);
    setCustom(true);
    setCustomTitle('');
    setDetail(null);
    setError(null);
    setShowHistory(false);
  }

  function openHistory(jiraKey?: string | null) {
    setHistoryJiraKey(jiraKey ?? null);
    setShowHistory(true);
    queryClient.invalidateQueries({ queryKey: ['workflow-history', projectId] });
  }

  function reset() {
    setSelectedKey(null);
    setCustom(false);
    setCustomTitle('');
    setDetail(null);
    setError(null);
    setShowHistory(false);
    setHistoryJiraKey(null);
  }

  function handleStartTask() {
    if (custom) {
      if (!customTitle.trim()) return;
      startWorkflowM.mutate({ customTitle: customTitle.trim() });
    } else if (selectedKey) {
      startWorkflowM.mutate({ jiraKey: selectedKey });
    }
  }

  function handleRestore(restored: RunDetail) {
    setDetail(restored);
    setShowHistory(false);
    if (restored.run.jiraKey) {
      setSelectedKey(restored.run.jiraKey);
      setCustom(false);
    } else {
      setCustom(true);
      setCustomTitle(restored.workflow?.customTitle || '');
    }
    queryClient.invalidateQueries({ queryKey: ['workflow-history', projectId] });
  }

  const providers = providersQ.data ?? [];
  const noProviders = providersQ.isSuccess && providers.length === 0;

  if (projectQ.isLoading) return <p className="text-sm text-slate-400">Loading…</p>;
  if (projectQ.isError || !projectQ.data)
    return <p className="text-sm text-red-600">Could not load project.</p>;

  const { project, myEnvironment } = projectQ.data;
  const board = boardQ.data;
  const hasTask = !!selectedKey || custom;
  const wf = detail?.workflow;

  return (
    <div className="space-y-4">
      {detail && wf && !showHistory && (
        <TaskStepper
          currentStep={wf.currentStep}
          completedSteps={wf.completedSteps}
          onNavigate={(step) => navigateStepM.mutate(step)}
          showHistory={showHistory}
          onShowHistory={() => openHistory()}
        />
      )}

      {showHistory && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">
              Workflow history
              {historyJiraKey && (
                <span className="ml-2 font-mono text-sm font-normal text-brand-700">
                  {historyJiraKey}
                </span>
              )}
            </h2>
            <button
              className="btn-secondary"
              onClick={() => {
                setShowHistory(false);
                setHistoryJiraKey(null);
              }}
            >
              ← Back to task
            </button>
          </div>
          {historyQ.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
          {historyQ.data && (
            <TaskHistoryGrid
              rows={
                historyJiraKey
                  ? historyQ.data.filter((row) => row.jiraKey === historyJiraKey)
                  : historyQ.data
              }
              onRestore={handleRestore}
            />
          )}
        </div>
      )}

      {!showHistory && (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <aside className="space-y-3">
            <Link to="/agent" className="btn-secondary w-full">
              ← Back to My Work
            </Link>

            <button
              className={[
                'w-full rounded-md border px-3 py-2 text-sm font-medium',
                custom
                  ? 'border-brand-500 bg-brand-50 text-brand-700'
                  : 'border-dashed border-slate-300 text-slate-600 hover:bg-slate-50',
              ].join(' ')}
              onClick={startCustomTask}
            >
              + New custom task
            </button>

            <button
              className="btn-ghost w-full text-xs"
              onClick={() => openHistory()}
            >
              View history
            </button>

            <div className="card p-3">
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-700">
                  Jira Tasks
                  {board?.configured && (
                    <span className="ml-1 text-xs font-normal text-slate-400">
                      ({board.total})
                    </span>
                  )}
                </h2>
                <div className="flex rounded-md border border-slate-200 p-0.5 text-xs">
                  <button
                    className={[
                      'rounded px-2 py-0.5',
                      scope === 'mine' ? 'bg-brand-600 text-white' : 'text-slate-600',
                    ].join(' ')}
                    onClick={() => setScope('mine')}
                  >
                    My tasks
                  </button>
                  <button
                    className={[
                      'rounded px-2 py-0.5',
                      scope === 'all' ? 'bg-brand-600 text-white' : 'text-slate-600',
                    ].join(' ')}
                    onClick={() => setScope('all')}
                  >
                    All
                  </button>
                </div>
              </div>

              {boardQ.isLoading && <p className="text-xs text-slate-400">Loading tasks…</p>}
              {boardQ.isError && (
                <p className="text-xs text-red-600">{getApiErrorMessage(boardQ.error)}</p>
              )}

              {board?.needsJiraIdentity && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                  <p className="font-medium">My tasks need your Jira account ID</p>
                  <p className="mt-1">{board.message}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      className="btn-secondary text-xs"
                      onClick={async () => {
                        try {
                          await api.post('/auth/me/jira-account/detect', { projectId });
                          await refresh();
                          await queryClient.invalidateQueries({
                            queryKey: ['jira-board', projectId],
                          });
                        } catch (err) {
                          setError({ message: getApiErrorMessage(err) });
                        }
                      }}
                    >
                      Detect from Jira
                    </button>
                    <Link to="/my-environments" className="btn-ghost text-xs underline">
                      Set manually →
                    </Link>
                    <button className="btn-ghost text-xs" onClick={() => setScope('all')}>
                      Show all tasks
                    </button>
                  </div>
                </div>
              )}

              {board && !board.configured && (
                <p className="text-xs text-amber-700">{board.message}</p>
              )}

              {board?.configured && (
                <div className="space-y-4">
                  {board.groups.map((group) => (
                    <div key={group.status}>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {group.status}
                        </span>
                        <span className="text-xs text-slate-400">{group.tasks.length}</span>
                      </div>
                      <div className="space-y-1">
                        {group.tasks.map((task) => (
                          <button
                            key={task.key}
                            onClick={() => selectTask(task)}
                            className={[
                              'w-full rounded-md border px-2 py-1.5 text-left text-xs',
                              selectedKey === task.key
                                ? 'border-brand-500 bg-brand-50'
                                : 'border-slate-200 hover:bg-slate-50',
                            ].join(' ')}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono font-medium text-brand-700">
                                {task.key}
                              </span>
                              <span className={`badge ${statusColor(task.statusCategory)}`}>
                                {task.status}
                              </span>
                            </div>
                            <p className="mt-0.5 line-clamp-2 text-slate-600">{task.summary}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>

          <section className="space-y-4">
            <div>
              <h1 className="text-xl font-semibold">{project.name}</h1>
              <p className="text-sm text-slate-500">
                Branch from <code>{project.git.productionBranch}</code> · PR to{' '}
                <code>{project.git.prTargetBranch}</code>
              </p>
            </div>

            {!myEnvironment && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                You have not configured your local environment for this project.{' '}
                <Link to="/my-environments" className="font-medium underline">
                  Set it up
                </Link>{' '}
                before running the Agent.
              </div>
            )}

            {noProviders && (
              <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-700">
                No AI provider is enabled. Ask an admin to configure one in Admin → AI Providers.
              </p>
            )}

            {error && (
              <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <p className="font-medium">{error.message}</p>
                {(error.code === 'needs_local_setup' || error.code === 'path_not_found') && (
                  <Link to="/my-environments" className="mt-1 inline-block underline">
                    Configure your local environment →
                  </Link>
                )}
              </div>
            )}

            {!detail && !hasTask && (
              <div className="card p-6 text-center text-sm text-slate-500">
                Select a Jira task from the left, or start a{' '}
                <button className="font-medium text-brand-600 underline" onClick={startCustomTask}>
                  new custom task
                </button>{' '}
                to begin.
              </div>
            )}

            {!detail && hasTask && (
              <div className="card space-y-4 p-4">
                {custom ? (
                  <div>
                    <span className="badge bg-brand-100 text-brand-700">Custom task</span>
                    <label className="label mt-2">Task title</label>
                    <input
                      className="input"
                      placeholder="e.g. Add SAP company lookup retry"
                      value={customTitle}
                      onChange={(e) => setCustomTitle(e.target.value)}
                    />
                  </div>
                ) : (
                  <SelectedJiraTaskCard
                    issue={selectedIssueQ.data}
                    loading={selectedIssueQ.isLoading}
                    error={selectedIssueQ.isError ? getApiErrorMessage(selectedIssueQ.error) : null}
                    productionBranch={project.git.productionBranch}
                  />
                )}
                <button
                  className="btn-primary"
                  disabled={
                    startWorkflowM.isPending ||
                    noProviders ||
                    (custom && !customTitle.trim())
                  }
                  onClick={handleStartTask}
                >
                  {startWorkflowM.isPending ? 'Starting…' : 'Start task →'}
                </button>
                <button className="btn-ghost ml-2" onClick={reset}>
                  Reset
                </button>
              </div>
            )}

            {detail && wf && (
              <WorkflowStepContent
                detail={detail}
                project={project}
                providers={providers}
                onChange={setDetail}
                onNavigate={(step) => navigateStepM.mutate(step)}
                onShowHistory={() => openHistory(detail.run.jiraKey)}
                onStartNewTask={reset}
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}
