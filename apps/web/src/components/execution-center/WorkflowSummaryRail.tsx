import type { AiProviderInfo, Project, RunDetail } from '@cpwork/shared';
import { migrateStep } from '../task-workflow/constants';
import { formatUsageTotals } from '../../lib/aiUsageFormat';
import { formatLlmLabel, getEffectiveLlm } from '../../lib/effectiveLlm';
import { taskAccent, taskMuted, taskStrong, taskSurface, taskTitle } from './taskStyles';

const DEV_AGENT_LABELS: Record<string, string> = {
  magento: 'Magento Developer',
  react: 'React Developer',
  laravel: 'Laravel Developer',
  qa: 'QA Engineer',
};

interface WorkflowSummaryRailProps {
  detail: RunDetail | null | undefined;
  project?: Project | null;
  providers?: AiProviderInfo[];
}

export function WorkflowSummaryRail({ detail, project, providers }: WorkflowSummaryRailProps) {
  if (!detail?.workflow) return null;
  const wf = detail.workflow;
  const step = migrateStep(wf.currentStep);
  const filesCount = detail.output?.files?.length ?? 0;
  const complexity = wf.requirementAnalysis?.estimatedComplexity;
  const quality = wf.aiReview?.codeQualityScore;
  const testRate = wf.testPassRate ?? detail.workflow.testPassRate;
  const deployOk = detail.deploy?.ok;
  const usageFmt = formatUsageTotals(detail.usageTotals);
  const hasUsage = (detail.usageTotals?.callCount ?? 0) > 0;

  return (
    <aside className={`${taskSurface} space-y-3 p-4 text-xs`}>
      <h3 className={`text-sm font-medium ${taskTitle}`}>Workflow summary</h3>
      <dl className="space-y-2">
        <div className="flex justify-between gap-2">
          <dt className={taskMuted}>Branch</dt>
          <dd className={`text-right font-mono ${taskStrong}`}>{detail.run.branchName || '—'}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className={taskMuted}>Planning AI</dt>
          <dd className="text-right">{formatLlmLabel(getEffectiveLlm(detail, project, providers, 'planning'))}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className={taskMuted}>Coding AI</dt>
          <dd className="text-right">{formatLlmLabel(getEffectiveLlm(detail, project, providers, 'coding'))}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className={taskMuted}>Agent</dt>
          <dd className="text-right">{DEV_AGENT_LABELS[wf.devAgentId] ?? wf.devAgentId}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className={taskMuted}>Current step</dt>
          <dd className="text-right capitalize">{step.replace(/_/g, ' ')}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className={taskMuted}>Files changed</dt>
          <dd className={taskStrong}>{filesCount}</dd>
        </div>
        {hasUsage && (
          <>
            <div className="border-t border-slate-700/40 pt-2">
              <p className={`mb-1.5 text-[10px] font-semibold uppercase tracking-wide ${taskMuted}`}>
                AI usage (this task)
              </p>
            </div>
            <div className="flex justify-between gap-2">
              <dt className={taskMuted}>Tokens</dt>
              <dd className={`text-right ${taskStrong}`}>{usageFmt.tokensLine}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className={taskMuted}>Credits</dt>
              <dd className={`text-right font-medium ${taskAccent}`}>{usageFmt.creditsLine}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className={taskMuted}>AI calls</dt>
              <dd className="text-right">{usageFmt.callsLine}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className={taskMuted}>AI time</dt>
              <dd className="text-right">{usageFmt.latencyLine}</dd>
            </div>
          </>
        )}
      </dl>
      <div className="flex flex-wrap gap-1.5 pt-1">
        {complexity && (
          <span className="rounded bg-slate-700/50 px-2 py-0.5 text-[10px] font-medium">
            Complexity {complexity}
          </span>
        )}
        {quality != null && (
          <span className="rounded bg-brand-600/20 px-2 py-0.5 text-[10px] font-medium text-brand-300">
            Quality {quality}%
          </span>
        )}
        {testRate && (
          <span className="rounded bg-slate-700/50 px-2 py-0.5 text-[10px] font-medium">
            Tests {testRate}
          </span>
        )}
        {deployOk != null && (
          <span
            className={`rounded px-2 py-0.5 text-[10px] font-medium ${deployOk ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}
          >
            Build {deployOk ? '✓' : '✗'}
          </span>
        )}
      </div>
    </aside>
  );
}
