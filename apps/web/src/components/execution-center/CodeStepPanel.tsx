import { ArrowRight, CheckCircle2 } from 'lucide-react';
import type { RunDetail, TaskWorkflowStep } from '@cpwork/shared';
import { FilesChangedPanel } from './FilesChangedPanel';
import { CodeGenerationProgressPanel } from './CodeGenerationProgressPanel';
import { WorkflowStepContent } from '../task-workflow/WorkflowStepContent';
import { previousStep, migrateStep } from '../task-workflow/constants';
import type { AiProviderInfo, Project } from '@cpwork/shared';
import { getEffectiveLlm } from '../../lib/effectiveLlm';
import { isCodeGenerationActive } from '../../lib/workflowStatus';
import {
  taskBody,
  taskBtnGhost,
  taskBtnPrimary,
  taskBtnSecondary,
  taskMuted,
  taskPanel,
  taskStickyFooter,
  taskStrong,
  taskSurface,
  taskTitle,
} from './taskStyles';
import type { WorkflowTab } from './WorkflowTabs';

interface CodeStepPanelProps {
  detail: RunDetail;
  project: Project;
  providers: AiProviderInfo[];
  onChange: (d: RunDetail) => void;
  onNavigate: (step: TaskWorkflowStep) => void;
  onWorkflowTabChange: (tab: WorkflowTab) => void;
  codeGenPending?: boolean;
}

export function CodeStepPanel({
  detail,
  project,
  providers,
  onChange,
  onNavigate,
  onWorkflowTabChange,
  codeGenPending = false,
}: CodeStepPanelProps) {
  const { run, output, workflow: wf } = detail;
  const step = migrateStep(wf!.currentStep);
  const hasOutput = !!(output?.files?.length);
  const isAgentStep = step === 'agent';
  const isGenerating = codeGenPending || isCodeGenerationActive(detail);
  const showLiveAgent = isAgentStep && !hasOutput && !isGenerating;

  const { provider: effectiveProvider, model: effectiveModel } = getEffectiveLlm(
    detail,
    project,
    providers,
    'coding',
  );
  const providerLabel = effectiveProvider ?? 'AI';
  const modelLabel =
    effectiveModel ??
    providers.find((p) => p.id === effectiveProvider)?.defaultModel ??
    'default model';

  const prev = previousStep(step);
  const canGoReview = hasOutput;
  const canGoBuild = hasOutput && detail.applied && step === 'code_review';

  return (
    <div className="relative min-h-[320px]">
      <div className={`space-y-4 ${isGenerating ? 'pointer-events-none opacity-90' : ''}`}>
      {hasOutput && (
        <div className={`${taskSurface} px-4 py-3`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h3 className={taskTitle}>Code generation complete</h3>
              {output?.summary && (
                <p className={`text-sm ${taskBody}`}>{output.summary}</p>
              )}
              <p className={`text-xs ${taskMuted}`}>
                Branch <span className={taskStrong}>{run.branchName || '—'}</span>
                {' · '}
                {providerLabel} ({modelLabel})
                {' · '}
                {output?.files?.length ?? 0} file(s)
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {detail.applied ? (
                <span className="rounded-full bg-emerald-500/20 px-2.5 py-1 text-xs font-medium text-emerald-400">
                  Applied
                </span>
              ) : (
                <span className="rounded-full bg-amber-500/20 px-2.5 py-1 text-xs font-medium text-amber-300">
                  Not applied
                </span>
              )}
              {step !== 'agent' && step !== 'code_review' && hasOutput && (
                <span className="rounded-full bg-brand-600/20 px-2.5 py-1 text-xs font-medium text-brand-300">
                  <CheckCircle2 className="mr-1 inline h-3 w-3" />
                  Past code step
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {isGenerating ? (
        <div className="relative z-30">
          <CodeGenerationProgressPanel
            detail={detail}
            generation={wf?.agentGeneration}
            providerLabel={providerLabel}
            modelLabel={modelLabel}
          />
        </div>
      ) : showLiveAgent ? (
        <WorkflowStepContent
          detail={detail}
          project={project}
          providers={providers}
          onChange={onChange}
          onNavigate={onNavigate}
          onWorkflowTabChange={onWorkflowTabChange}
          hideSetupSteps
        />
      ) : hasOutput ? (
        <>
          {!detail.applied && (
            <div className={`${taskPanel} border-amber-500/30 bg-amber-500/5 px-4 py-3`}>
              <p className={`text-sm ${taskBody}`}>
                Review diffs on the Review tab and apply changes, then run build verification.
              </p>
              <button
                type="button"
                className={`${taskBtnSecondary} mt-2`}
                onClick={() => onWorkflowTabChange('review')}
              >
                Open full review →
              </button>
            </div>
          )}
          <FilesChangedPanel detail={detail} title="Code changes" />
        </>
      ) : (
        <div className={`${taskPanel} p-4`}>
          <p className={`text-sm ${taskMuted}`}>
            No code generated yet. Approve the plan on the Plan step, then run the Developer Agent.
          </p>
          <button
            type="button"
            className={`${taskBtnSecondary} mt-3`}
            onClick={() => onWorkflowTabChange('plan')}
          >
            Go to Plan &amp; approval →
          </button>
        </div>
      )}

      <div className={taskStickyFooter}>
        {prev ? (
          <button type="button" className={taskBtnGhost} onClick={() => onNavigate(prev)}>
            ← Back
          </button>
        ) : (
          <button
            type="button"
            className={taskBtnGhost}
            onClick={() => onWorkflowTabChange('plan')}
          >
            ← Plan &amp; approval
          </button>
        )}
        <div className="flex items-center gap-2">
          {hasOutput && !detail.applied && canGoReview && (
            <button
              type="button"
              className={taskBtnSecondary}
              onClick={() => onWorkflowTabChange('review')}
            >
              Review &amp; apply
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
          {canGoBuild && (
            <button
              type="button"
              className={taskBtnPrimary}
              onClick={() => onWorkflowTabChange('build')}
            >
              Build verification
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
