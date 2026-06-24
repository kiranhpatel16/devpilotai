import { useQuery } from '@tanstack/react-query';
import type { Activity, RunDetail } from '@cpwork/shared';
import { api } from '../../lib/api';
import { AGENT_DEFINITIONS } from '../layout/navConfig';
import { taskMuted } from './taskStyles';

interface AgentStatusBannerProps {
  detail: RunDetail | null;
  runId: string | null;
  polling: boolean;
}

const STEP_AGENT: Record<string, string> = {
  select: 'planner',
  describe: 'planner',
  plan: 'planner',
  review_plan: 'planner',
  branch: 'developer',
  agent: 'developer',
  code_review: 'reviewer',
  deploy: 'deployment',
  commit: 'deployment',
  jira_comment: 'deployment',
  done: 'deployment',
};

const STEP_MESSAGE: Record<string, string> = {
  agent: 'Generating code…',
  plan: 'Building implementation plan…',
  review_plan: 'Awaiting plan approval…',
  code_review: 'Reviewing changes…',
  deploy: 'Running tests & deploy…',
  commit: 'Preparing commit…',
  jira_comment: 'Posting Jira update…',
};

export function AgentStatusBanner({ detail, runId, polling }: AgentStatusBannerProps) {
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
  const step = activeDetail?.workflow?.currentStep;
  const runStatus = activeDetail?.run.status;
  if (!step) return null;

  let agentId = STEP_AGENT[step] ?? 'planner';
  let message = STEP_MESSAGE[step] ?? `Processing ${step.replace(/_/g, ' ')}…`;

  if (runStatus === 'awaiting_review' || step === 'code_review') {
    agentId = 'reviewer';
    message = 'Awaiting your review';
  }

  const agent = AGENT_DEFINITIONS.find((a) => a.id === agentId);
  const lastActivity = activitiesQ.data?.[0];

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-700/60 bg-[#0f0f1a] px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-500" />
        </span>
        <span className="text-sm font-medium text-white">{agent?.label ?? 'Agent'}</span>
        <span className={`text-xs ${taskMuted}`}>{message}</span>
      </div>
      {lastActivity && (
        <span className={`truncate text-xs ${taskMuted}`}>{lastActivity.summary}</span>
      )}
    </div>
  );
}
