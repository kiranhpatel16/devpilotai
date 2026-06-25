import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AiProviderInfo,
  JiraBoard,
  JiraIssueDetail,
  Project,
  RunDetail,
  TaskHistoryRow,
  TaskWorkflowStep,
  UserProjectEnvironment,
} from '@cpwork/shared';
import { api, getApiErrorCode, getApiErrorMessage } from '../lib/api';
import { useExecution } from '../context/ExecutionContext';
import { WorkflowBusyProvider, useWorkflowBusy } from '../context/WorkflowBusyContext';
import { TaskHistoryGrid } from '../components/task-workflow/TaskHistoryGrid';
import { TaskActionBar } from '../components/execution-center/TaskActionBar';
import { AgentStatusBanner } from '../components/execution-center/AgentStatusBanner';
import { LiveChatDrawer } from '../components/execution-center/LiveChatDrawer';
import { StepContentRouter } from '../components/execution-center/StepContentRouter';
import {
  WorkflowTabs,
  getTabForStep,
  type WorkflowTab,
} from '../components/execution-center/WorkflowTabs';
import { isAgentStepAwaitingRun } from '../lib/workflowAdvance';
import { customTaskPath } from '../lib/customTaskRoutes';
import { taskCard, taskHeading, taskMuted } from '../components/execution-center/taskStyles';

interface ProjectDetail {
  project: Project;
  myRole: string | null;
  myEnvironment: UserProjectEnvironment | null;
}

type WorkflowRestoreLocationState = {
  restoredDetail?: RunDetail;
};

export function TaskExecutionCenterPage() {
  return (
    <WorkflowBusyProvider>
      <TaskExecutionCenterPageInner />
    </WorkflowBusyProvider>
  );
}

function TaskExecutionCenterPageInner() {
  const { projectId = '', taskKey: taskKeyParam = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { setBranchName, setProjectName } = useExecution();

  const decodedTaskKey = taskKeyParam ? decodeURIComponent(taskKeyParam) : null;
  const isCustomRoute =
    decodedTaskKey === '_custom' || searchParams.get('type') === 'custom';
  const runIdParam = searchParams.get('runId');

  const [selectedKey, setSelectedKey] = useState<string | null>(
    isCustomRoute ? null : decodedTaskKey,
  );
  const [custom, setCustom] = useState(isCustomRoute);
  const [customTitle, setCustomTitle] = useState('');
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [workflowTab, setWorkflowTab] = useState<WorkflowTab>('requirements');

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
    queryKey: ['jira-board', projectId, 'mine'],
    queryFn: async () =>
      (
        await api.get<{ board: JiraBoard }>(
          `/projects/${projectId}/jira/tasks?scope=mine`,
        )
      ).data.board,
    enabled: !!projectId,
  });

  const issueQ = useQuery({
    queryKey: ['jira-issue', projectId, selectedKey],
    queryFn: async () =>
      selectedKey
        ? (
            await api.get<{ issue: JiraIssueDetail }>(
              `/projects/${projectId}/jira/issues/${selectedKey}`,
            )
          ).data.issue
        : null,
    enabled: !!projectId && !!selectedKey && !custom,
  });

  const activitiesQ = useQuery({
    queryKey: ['workflow-activities', detail?.run.id],
    queryFn: async () =>
      detail
        ? (
            await api.get<{ activities: import('@cpwork/shared').Activity[] }>(
              `/workflow/runs/${detail.run.id}/activities`,
            )
          ).data.activities
        : [],
    enabled: !!detail?.run.id,
  });

  const historyQ = useQuery({
    queryKey: ['workflow-history', projectId],
    queryFn: async () =>
      (await api.get<{ rows: TaskHistoryRow[] }>(`/workflow/history?projectId=${projectId}`))
        .data.rows,
    enabled: !!projectId && showHistory,
  });

  const restoreQ = useQuery({
    queryKey: ['workflow-run', runIdParam],
    queryFn: async () =>
      (await api.get<{ detail: RunDetail }>(`/workflow/runs/${runIdParam}`)).data.detail,
    enabled: !!projectId && isCustomRoute && !!runIdParam && !detail,
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
      if (d.workflow?.currentStep) setWorkflowTab(getTabForStep(d.workflow.currentStep));
      if (!d.run.jiraKey) {
        navigate(customTaskPath(projectId, d.run.id), { replace: true });
      }
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
    onSuccess: (d) => {
      setDetail(d);
      if (d.workflow?.currentStep) setWorkflowTab(getTabForStep(d.workflow.currentStep));
    },
    onError: (err) => setError({ message: getApiErrorMessage(err) }),
  });

  const pauseM = useMutation({
    mutationFn: async () => {
      if (!detail) throw new Error('No active run');
      const path =
        detail.run.status === 'paused'
          ? `/workflow/runs/${detail.run.id}/resume`
          : `/workflow/runs/${detail.run.id}/pause`;
      return (await api.post<{ detail: RunDetail }>(path)).data.detail;
    },
    onSuccess: (d) => {
      setDetail(d);
      queryClient.invalidateQueries({ queryKey: ['workflow-activities', d.run.id] });
    },
    onError: (err) => setError({ message: getApiErrorMessage(err) }),
  });

  const cancelM = useMutation({
    mutationFn: async () => {
      if (!detail) throw new Error('No active run');
      return (
        await api.post<{ detail: RunDetail }>(`/workflow/runs/${detail.run.id}/cancel`)
      ).data.detail;
    },
    onSuccess: () => {
      reset();
      queryClient.invalidateQueries({ queryKey: ['workflow-history', projectId] });
    },
    onError: (err) => setError({ message: getApiErrorMessage(err) }),
  });

  useEffect(() => {
    if (isCustomRoute) {
      setCustom(true);
      setSelectedKey(null);
      return;
    }
    if (decodedTaskKey && decodedTaskKey !== '_custom') {
      setSelectedKey(decodedTaskKey);
      setCustom(false);
    }
  }, [decodedTaskKey, isCustomRoute]);

  useEffect(() => {
    if (detail?.workflow?.currentStep) {
      setWorkflowTab(getTabForStep(detail.workflow.currentStep));
    }
  }, [detail?.workflow?.currentStep]);

  useEffect(() => {
    setProjectName(projectQ.data?.project.name ?? null);
    setBranchName(detail?.run.branchName ?? detail?.git?.branch ?? null);
    return () => {
      setBranchName(null);
      setProjectName(null);
    };
  }, [detail, projectQ.data, setBranchName, setProjectName]);

  function startCustomTask() {
    navigate(`/workspaces/${projectId}?tab=custom&create=1`);
  }

  function reset() {
    navigate(`/workspaces/${projectId}`);
  }

  function handleStartTask() {
    if (custom) {
      if (!customTitle.trim()) return;
      startWorkflowM.mutate({ customTitle: customTitle.trim() });
    } else if (selectedKey) {
      startWorkflowM.mutate({ jiraKey: selectedKey });
    }
  }

  function applyRestoredDetail(restored: RunDetail) {
    setDetail(restored);
    setShowHistory(false);
    if (restored.run.jiraKey) {
      setSelectedKey(restored.run.jiraKey);
      setCustom(false);
    } else {
      setCustom(true);
      setCustomTitle(restored.workflow?.customTitle || '');
    }
    if (restored.workflow?.currentStep) {
      setWorkflowTab(getTabForStep(restored.workflow.currentStep));
    }
  }

  function handleRestore(restored: RunDetail) {
    applyRestoredDetail(restored);
    if (restored.run.jiraKey) {
      navigate(`/workspaces/${projectId}/tasks/${encodeURIComponent(restored.run.jiraKey)}`);
    } else {
      navigate(customTaskPath(projectId, restored.run.id));
    }
    queryClient.invalidateQueries({ queryKey: ['workflow-history', projectId] });
  }

  useEffect(() => {
    const restored = (location.state as WorkflowRestoreLocationState | null)?.restoredDetail;
    if (!restored || restored.run.projectId !== projectId) return;

    applyRestoredDetail(restored);
    navigate(customTaskPath(projectId, restored.run.id), { replace: true, state: null });
    queryClient.invalidateQueries({ queryKey: ['workflow-history', projectId] });
    // Only apply navigation state once on entry from Task History (or similar).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!restoreQ.data || detail) return;
    if (restoreQ.data.run.projectId !== projectId) return;
    applyRestoredDetail(restoreQ.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreQ.data, detail, projectId]);

  const providers = providersQ.data ?? [];
  const noProviders = providersQ.isSuccess && providers.length === 0;

  const wf = detail?.workflow;
  const polling =
    !!detail &&
    !!wf &&
    detail.run.status !== 'paused' &&
    detail.run.status !== 'cancelled' &&
    !isAgentStepAwaitingRun(detail) &&
    (['agent', 'deploy', 'branch'].includes(wf.currentStep) ||
      detail.run.status === 'deploying' ||
      !!detail.deploy?.running);

  useWorkflowBusy('workflow-poll', polling, 'Agent working…');
  useWorkflowBusy('start-task', startWorkflowM.isPending, 'Starting task…');
  useWorkflowBusy('pause-task', pauseM.isPending, 'Updating task…');
  useWorkflowBusy('cancel-task', cancelM.isPending, 'Cancelling task…');
  useWorkflowBusy('navigate-step', navigateStepM.isPending, 'Updating step…');
  useWorkflowBusy(
    'deploy-running',
    !!detail?.deploy?.running,
    'Running local deploy…',
  );

  if (projectQ.isLoading) return <p className={`text-sm ${taskMuted}`}>Loading…</p>;
  if (projectQ.isError || !projectQ.data)
    return <p className="text-sm text-red-400">Could not load project.</p>;

  if (!taskKeyParam) {
    return <Navigate to={`/workspaces/${projectId}`} replace />;
  }

  if (isCustomRoute && runIdParam && !detail && restoreQ.isLoading) {
    return <p className={`text-sm ${taskMuted}`}>Loading custom task…</p>;
  }

  if (isCustomRoute && runIdParam && !detail && restoreQ.isError) {
    return (
      <p className="text-sm text-red-400">
        Could not load custom task.{' '}
        <Link to={`/workspaces/${projectId}?tab=custom`} className="underline">
          Back to custom tasks
        </Link>
      </p>
    );
  }

  if (isCustomRoute && !runIdParam && !detail) {
    const hasPendingRestore = !!(location.state as WorkflowRestoreLocationState | null)
      ?.restoredDetail;
    if (!hasPendingRestore) {
      return (
        <p className={`text-sm ${taskMuted}`}>
          Open a custom task from the{' '}
          <Link to={`/workspaces/${projectId}?tab=custom`} className="underline">
            workspace custom tasks
          </Link>{' '}
          list.
        </p>
      );
    }
  }

  const { project, myEnvironment } = projectQ.data;
  const board = boardQ.data;
  const hasTask = !!selectedKey || custom;
  const boardTask = board?.groups.flatMap((g) => g.tasks).find((t) => t.key === selectedKey);
  const taskSummary = boardTask?.summary;
  const jiraSnapshot = (wf?.jiraSnapshot as JiraIssueDetail | null) ?? issueQ.data ?? boardTask ?? null;
  const preStart = hasTask && !detail;

  const showAgentBanner =
    !!detail &&
    !!wf &&
    detail.run.status !== 'paused' &&
    detail.run.status !== 'cancelled' &&
    detail.run.status !== 'done';

  if (showHistory) {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className={`text-lg font-semibold ${taskHeading}`}>Workflow history</h2>
          <button type="button" className="btn-secondary" onClick={() => setShowHistory(false)}>
            ← Back to task
          </button>
        </div>
        {historyQ.isLoading && <p className={`text-sm ${taskMuted}`}>Loading…</p>}
        {historyQ.data && <TaskHistoryGrid rows={historyQ.data} onRestore={handleRestore} />}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section className="min-w-0 space-y-4">
        <div className={`${taskCard} space-y-4 p-5`}>
          <TaskActionBar
            projectId={projectId}
            detail={detail}
            selectedKey={selectedKey}
            customTitle={customTitle}
            custom={custom}
            taskSummary={taskSummary}
            jiraUrl={jiraSnapshot?.url}
            statusLabel={boardTask?.statusCategory ?? jiraSnapshot?.statusCategory}
            pausePending={pauseM.isPending}
            cancelPending={cancelM.isPending}
            startPending={startWorkflowM.isPending}
            canStart={hasTask && !noProviders && (!custom || !!customTitle.trim())}
            onPause={() => detail && pauseM.mutate()}
            onCancel={() => (detail ? cancelM.mutate() : reset())}
            onStart={handleStartTask}
            onStartCustom={startCustomTask}
            onShowHistory={() => {
              setShowHistory(true);
              queryClient.invalidateQueries({ queryKey: ['workflow-history', projectId] });
            }}
          />

          {hasTask && (
            <>
              <WorkflowTabs
                currentStep={wf?.currentStep}
                activeTab={workflowTab}
                onTabChange={setWorkflowTab}
                preStart={preStart}
              />

              {showAgentBanner && (
                <AgentStatusBanner
                  detail={detail}
                  runId={detail?.run.id ?? null}
                  polling={polling}
                />
              )}

              <StepContentRouter
                tab={workflowTab}
                detail={detail}
                preStart={preStart}
                project={project}
                providers={providers}
                issue={jiraSnapshot as JiraIssueDetail | null}
                customTitle={customTitle}
                custom={custom}
                selectedKey={selectedKey}
                activities={activitiesQ.data ?? []}
                onChange={setDetail}
                onNavigate={(step) => navigateStepM.mutate(step)}
                onCustomTitleChange={setCustomTitle}
                onWorkflowTabChange={setWorkflowTab}
                onError={(message) => setError({ message })}
              />
            </>
          )}

          {!hasTask && (
            <p className={`py-8 text-center text-sm ${taskMuted}`}>
              Select a task from the workspace to begin.
            </p>
          )}
        </div>

        {!myEnvironment && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            Local environment not configured.{' '}
            <Link to="/settings/environments" className="font-medium underline">
              Set it up
            </Link>{' '}
            before running agents.
          </div>
        )}

        {noProviders && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            No AI provider enabled. Configure in Settings → AI Providers.
          </p>
        )}

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            <p className="font-medium">{error.message}</p>
            {(error.code === 'needs_local_setup' || error.code === 'path_not_found') && (
              <Link to="/settings/environments" className="mt-1 inline-block underline">
                Configure environment →
              </Link>
            )}
          </div>
        )}
      </section>

      <LiveChatDrawer projectId={projectId} />
    </div>
  );
}

/** @deprecated Use TaskExecutionCenterPage */
export const AgentPortPage = TaskExecutionCenterPage;
