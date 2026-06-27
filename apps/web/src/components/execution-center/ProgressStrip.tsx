import type { AiProviderInfo, Project, RunDetail } from '@cpwork/shared';
import { formatUsageTotals } from '../../lib/aiUsageFormat';
import { formatEffectiveLlmLabel, getEffectiveLlm } from '../../lib/effectiveLlm';
import { isCodeGenerationActive } from '../../lib/workflowStatus';
import { taskBody, taskMuted, taskSurface, taskTitle } from './taskStyles';

interface ProgressStripProps {
  detail?: RunDetail | null;
  preStart?: boolean;
  project?: Project | null;
  providers?: AiProviderInfo[];
}

function computeProgress(detail: RunDetail | null | undefined, preStart?: boolean): number {
  if (preStart || !detail?.workflow) return 0;
  const total = 13;
  const completed = detail.workflow.completedSteps?.length ?? 0;
  return Math.min(100, Math.round((completed / total) * 100));
}

export function ProgressStrip({ detail, preStart, project, providers }: ProgressStripProps) {
  const pct = computeProgress(detail, preStart);
  const started = detail?.run.createdAt;
  const elapsed = started
    ? Math.max(1, Math.round((Date.now() - new Date(started).getTime()) / 60_000))
    : 0;
  const usageFmt = formatUsageTotals(detail?.usageTotals);
  const showUsage = (detail?.usageTotals?.callCount ?? 0) > 0;
  const generating = isCodeGenerationActive(detail);

  return (
    <div className={`flex flex-wrap items-center gap-4 ${taskSurface} px-3 py-2 text-xs`}>
      <div className="flex min-w-[120px] flex-1 items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-neutral-800">
          <div
            className="h-full rounded-full bg-brand-600 transition-all"
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        </div>
        <span className={`font-medium ${taskTitle}`}>{pct}%</span>
      </div>
      <span className={taskMuted}>
        Elapsed <span className="text-slate-700 dark:text-slate-200">{elapsed}m</span>
      </span>
      {detail && getEffectiveLlm(detail, project, providers).provider && (
        <span className={taskMuted}>
          {formatEffectiveLlmLabel(detail, project, providers)}
        </span>
      )}
      {showUsage && (
        <span className={taskMuted}>
          {usageFmt.tokensLine}
          {' · '}
          <span className="font-medium text-brand-600 dark:text-brand-300">{usageFmt.creditsLine}</span>
        </span>
      )}
      {generating && !showUsage && (
        <span className={`${taskMuted} animate-pulse`}>Token usage updating…</span>
      )}
    </div>
  );
}
