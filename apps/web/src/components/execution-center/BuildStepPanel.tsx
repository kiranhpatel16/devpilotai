import type { Project, RunDetail, TaskWorkflowStep } from '@cpwork/shared';
import {
  DEPLOY_PROFILE_LABELS,
  deployProfileReason,
  resolveDeployProfile,
} from '@cpwork/shared';
import { ArrowRight, Loader2 } from 'lucide-react';
import { useDeployPipeline } from '../../hooks/useDeployPipeline';
import { useWorkflowBusy } from '../../context/WorkflowBusyContext';
import { getDeployBusyDetail } from '../../lib/workflowStatus';
import { DeployProgressModal } from '../task-workflow/DeployProgressModal';
import { migrateStep } from '../task-workflow/constants';
import { FilesChangedPanel } from './FilesChangedPanel';
import {
  taskBtnGhost,
  taskBtnPrimary,
  taskBtnSecondary,
  taskMuted,
  taskPanel,
  taskStickyFooter,
  taskTitle,
  taskWarningText,
} from './taskStyles';
import type { WorkflowTab } from './WorkflowTabs';

interface BuildStepPanelProps {
  detail: RunDetail;
  project: Project;
  onChange: (d: RunDetail) => void;
  onNavigate: (step: TaskWorkflowStep) => void;
  onWorkflowTabChange: (tab: WorkflowTab) => void;
}

export function BuildStepPanel({
  detail,
  project,
  onChange,
  onWorkflowTabChange,
}: BuildStepPanelProps) {
  const { workflow: wf } = detail;
  const step = migrateStep(wf!.currentStep);
  const {
    runDeployPipeline,
    runDeployFix,
    applyDeployFix,
    redeployAfterFix,
    pipelineRunning,
    deployModalOpen,
    openDeployModal,
    deployPhase,
    deployModalError,
    closeDeployModal,
    deployFixing,
    deployApplying,
    deployPending,
  } = useDeployPipeline(detail, onChange);

  useWorkflowBusy(
    'deploy-pipeline',
    pipelineRunning || deployPending || !!detail.deploy?.running,
    'Running build verification…',
    getDeployBusyDetail(detail.deploy),
  );

  useWorkflowBusy(
    'deploy-fix-ai',
    deployFixing,
    'AI fixing deploy error…',
    'Analyzing build output and proposing a Magento-standard fix.',
  );

  useWorkflowBusy(
    'deploy-apply-fix',
    deployApplying,
    'Applying deploy fix…',
    'Writing corrected files to your local project.',
  );

  const changedPaths = detail.output?.files?.map((f) => f.path) ?? [];
  const deployProfile = resolveDeployProfile(
    changedPaths,
    project.defaults.deployProfile ?? 'auto',
  );
  const deployProfileHint = deployProfileReason(deployProfile, changedPaths);
  const buildDone = !!detail.deploy?.ok;
  const onDeployStep = step === 'deploy';

  return (
    <div className="space-y-4">
      {!onDeployStep && detail.applied && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <p className={`text-sm ${taskWarningText}`}>
            Finish code review on the Review tab, then continue here to run build verification.
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

      {!detail.applied && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <p className={`text-sm ${taskWarningText}`}>Apply code changes before build verification.</p>
          <button
            type="button"
            className={`${taskBtnSecondary} mt-2`}
            onClick={() => onWorkflowTabChange('review')}
          >
            Go to Review →
          </button>
        </div>
      )}

      {detail.applied && <FilesChangedPanel detail={detail} compact title="Applied changes" />}

      <div className={`${taskPanel} p-4`}>
        <h3 className={taskTitle}>Build &amp; deployment verification</h3>
        <p className={`mt-1 text-xs ${taskMuted}`}>
          Magento: setup:upgrade, compile, static deploy, cache clean/flush
        </p>
        <div className="mt-3 rounded-md border border-brand-500/25 bg-brand-500/5 px-3 py-2">
          <p className="text-xs font-medium text-brand-300">
            Profile: {DEPLOY_PROFILE_LABELS[deployProfile]}
          </p>
          <p className={`mt-0.5 text-[11px] ${taskMuted}`}>{deployProfileHint}</p>
        </div>
        {detail.deploy && !detail.deploy.running && (
          <p className={`mt-2 text-xs ${detail.deploy.ok ? 'text-emerald-400' : 'text-red-400'}`}>
            Last run: {detail.deploy.ok ? 'Succeeded' : 'Failed'}
          </p>
        )}
        <ul className="mt-3 space-y-1">
          {(detail.deploy?.steps ?? []).map((s) => (
            <li key={s.key} className="flex justify-between text-xs">
              <span className={taskMuted}>{s.label}</span>
              <span className={s.ok ? 'text-emerald-400' : s.skipped ? taskMuted : 'text-red-400'}>
                {s.skipped ? 'skipped' : s.ok ? '✓' : '✗'}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={taskBtnPrimary}
            disabled={pipelineRunning || deployPending || !detail.applied || !onDeployStep}
            onClick={() => void runDeployPipeline()}
          >
            {pipelineRunning || deployPending || detail.deploy?.running ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Running…
              </>
            ) : (
              'Run build verification'
            )}
          </button>
          {detail.deploy && !detail.deploy.running && (
            <button type="button" className={taskBtnGhost} onClick={openDeployModal}>
              View terminal output
            </button>
          )}
        </div>
      </div>

      <DeployProgressModal
        open={deployModalOpen}
        detail={detail}
        phase={deployPhase}
        error={deployModalError}
        fixing={deployFixing}
        applying={deployApplying}
        onClose={closeDeployModal}
        onRetry={() => void runDeployPipeline()}
        onProposeFix={(instructions) => void runDeployFix(instructions)}
        onApplyFix={(paths) => void applyDeployFix(paths)}
        onRedeploy={() => void redeployAfterFix()}
      />

      <div className={taskStickyFooter}>
        <button
          type="button"
          className={taskBtnGhost}
          onClick={() => onWorkflowTabChange('review')}
        >
          ← Review
        </button>
        {buildDone && (
          <button
            type="button"
            className={taskBtnPrimary}
            onClick={() => onWorkflowTabChange('pr')}
          >
            Continue to PR
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
