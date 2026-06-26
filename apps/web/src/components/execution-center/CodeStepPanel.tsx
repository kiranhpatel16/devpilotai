import { ArrowRight, CheckCircle2 } from 'lucide-react';
import type { RunDetail, TaskWorkflowStep } from '@cpwork/shared';
import { FilesChangedPanel } from './FilesChangedPanel';
import { WorkflowStepContent } from '../task-workflow/WorkflowStepContent';
import { previousStep } from '../task-workflow/constants';
import type { AiProviderInfo, Project } from '@cpwork/shared';
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
}

export function CodeStepPanel({
  detail,
  project,
  providers,
  onChange,
  onNavigate,
  onWorkflowTabChange,
}: CodeStepPanelProps) {
  const { run, output, workflow: wf } = detail;
  const step = wf!.currentStep;
  const hasOutput = !!(output?.files?.length);
  const isAgentStep = step === 'agent';
  const showLiveAgent = isAgentStep && !hasOutput;

  const providerLabel = run.provider ?? 'AI';
  const modelLabel =
    run.model ?? providers.find((p) => p.id === run.provider)?.defaultModel ?? 'default model';

  const prev = previousStep(step);
  const canGoReview = hasOutput;
  const canGoTests = detail.applied && step !== 'agent';

  return (
    <div className="space-y-4">
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

      {showLiveAgent ? (
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
                Review diffs below, then go to <strong className={taskStrong}>Review</strong> to apply
                changes before running tests.
              </p>
              <button
                type="button"
                className={`${taskBtnSecondary} mt-2`}
                onClick={() => onWorkflowTabChange('review')}
              >
                Go to Review →
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
            Go to Plan →
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
            ← Plan
          </button>
        )}
        <div className="flex items-center gap-2">
          {canGoReview && (
            <button
              type="button"
              className={taskBtnSecondary}
              onClick={() => onWorkflowTabChange('review')}
            >
              Review
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
          {canGoTests && (
            <button
              type="button"
              className={taskBtnPrimary}
              onClick={() => onWorkflowTabChange('tests')}
            >
              Tests
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
