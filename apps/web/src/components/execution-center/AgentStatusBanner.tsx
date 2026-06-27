import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Activity, RunDetail } from '@cpwork/shared';
import { api } from '../../lib/api';
import { isAgentStepAwaitingRun } from '../../lib/workflowAdvance';
import { formatWorkflowStatusLine, getWorkflowAgentStatus, shouldPollWorkflow } from '../../lib/workflowStatus';
import { taskMuted, taskSurface, taskTitle } from './taskStyles';

interface AgentStatusBannerProps {
  detail: RunDetail | null;
  runId: string | null;
  polling: boolean;
  onDetailUpdate?: (detail: RunDetail) => void;
}

export function AgentStatusBanner({ detail, runId, polling, onDetailUpdate }: AgentStatusBannerProps) {
  const pollQ = useQuery({
    queryKey: ['workflow-run-poll', runId],
    queryFn: async () =>
      runId ? (await api.get<{ detail: RunDetail }>(`/workflow/runs/${runId}`)).data.detail : null,
    enabled: !!runId && polling,
    refetchInterval: polling ? 2000 : false,
  });

  const activitiesQ = useQuery({
    queryKey: ['workflow-activities', runId],
    queryFn: async () =>
      runId
        ? (await api.get<{ activities: Activity[] }>(`/workflow/runs/${runId}/activities`)).data
            .activities
        : [],
    enabled: !!runId,
    refetchInterval: polling ? 5000 : false,
  });

  const activeDetail = pollQ.data ?? detail;
  const lastActivity = activitiesQ.data?.[0];

  useEffect(() => {
    if (pollQ.data) onDetailUpdate?.(pollQ.data);
  }, [pollQ.data, onDetailUpdate]);

  const status = getWorkflowAgentStatus(activeDetail, lastActivity);
  if (!status) return null;

  const awaitingRun = isAgentStepAwaitingRun(activeDetail);
  const showPulse = polling && !awaitingRun;

  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 ${taskSurface} px-3 py-2`}>
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          {showPulse ? (
            <>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
            </>
          ) : (
            <span className="relative inline-flex h-2 w-2 rounded-full bg-slate-400 dark:bg-neutral-500" />
          )}
        </span>
        <span className={`text-sm font-medium ${taskTitle}`}>{formatWorkflowStatusLine(status)}</span>
      </div>
      {lastActivity && (
        <span className={`truncate text-xs ${taskMuted}`}>{lastActivity.summary}</span>
      )}
    </div>
  );
}

export { shouldPollWorkflow };
