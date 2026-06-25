import { useQuery } from '@tanstack/react-query';
import type { Activity, RunDetail } from '@cpwork/shared';
import { api } from '../../lib/api';
import { AGENT_DEFINITIONS } from '../layout/navConfig';
import { StatusBadge } from '../ui/StatusBadge';
import { ActivityFeed, buildActivityFeed, mapActivities } from './ActivityFeed';
import { taskBody, taskMuted, taskPanel, taskPanelHeader, taskSurface, taskTitle } from './taskStyles';

interface AgentConsoleProps {
  detail: RunDetail | null;
  runId: string | null;
  polling: boolean;
}

export function AgentConsole({ detail, runId, polling }: AgentConsoleProps) {
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
    refetchInterval: polling ? 5000 : 30_000,
  });

  const activeDetail = pollQ.data ?? detail;
  const step = activeDetail?.workflow?.currentStep;
  const agentMap: Record<string, string> = {
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
  const activeAgent = step ? agentMap[step] ?? 'planner' : null;

  const apiItems = mapActivities(activitiesQ.data ?? []);
  const fallbackItems = buildActivityFeed(step, []);
  const activityItems = apiItems.length > 0 ? apiItems : fallbackItems;

  return (
    <aside className="flex h-full flex-col gap-4">
      <div className={taskPanel}>
        <header className={taskPanelHeader}>
          <h3 className={taskTitle}>Agent Console</h3>
        </header>

        <div className="space-y-2 p-3">
          {AGENT_DEFINITIONS.map((a) => (
            <div
              key={a.id}
              className={[
                'rounded-lg border px-3 py-2',
                activeAgent === a.id
                  ? 'border-brand-500/40 bg-brand-600/10'
                  : `${taskSurface}`,
              ].join(' ')}
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs font-medium ${taskBody}`}>{a.label}</span>
                <StatusBadge
                  label={activeAgent === a.id ? 'Active' : 'Online'}
                  variant={activeAgent === a.id ? 'busy' : 'online'}
                  dot
                />
              </div>
              {activeAgent === a.id && step && (
                <p className={`mt-1 text-xs ${taskMuted}`}>
                  {step === 'agent' ? 'Generating code…' : `Processing ${step}…`}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className={`${taskPanel} flex-1`}>
        <header className={taskPanelHeader}>
          <h3 className={taskTitle}>Activity Feed</h3>
        </header>
        <ActivityFeed items={activityItems} />
      </div>
    </aside>
  );
}
