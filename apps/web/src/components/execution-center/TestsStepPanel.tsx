import { useEffect, useRef, useState } from 'react';
import type { Activity, Project, RunDetail, TaskWorkflowStep } from '@cpwork/shared';
import {
  DEPLOY_PROFILE_LABELS,
  deployProfileReason,
  resolveDeployProfile,
} from '@cpwork/shared';
import { ArrowRight, CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import { useDeployPipeline } from '../../hooks/useDeployPipeline';
import { useTestPipeline } from '../../hooks/useTestPipeline';
import { useWorkflowBusy } from '../../context/WorkflowBusyContext';
import { DeployProgressModal } from '../task-workflow/DeployProgressModal';
import { previousStep } from '../task-workflow/constants';
import { ActivityFeed, mapActivities } from './ActivityFeed';
import {
  taskAccent,
  taskBody,
  taskBtnGhost,
  taskBtnPrimary,
  taskBtnSecondary,
  taskCodeSurface,
  taskMuted,
  taskPanel,
  taskPanelHeader,
  taskStickyFooter,
  taskStrong,
  taskSurface,
  taskTitle,
} from './taskStyles';
import type { WorkflowTab } from './WorkflowTabs';

interface TestsStepPanelProps {
  detail: RunDetail;
  project: Project;
  activities: Activity[];
  onChange: (d: RunDetail) => void;
  onNavigate: (step: TaskWorkflowStep) => void;
  onWorkflowTabChange: (tab: WorkflowTab) => void;
}

export function TestsStepPanel({
  detail,
  project,
  activities,
  onChange,
  onNavigate,
  onWorkflowTabChange,
}: TestsStepPanelProps) {
  const { run, output } = detail;
  const wf = detail.workflow!;
  const step = wf.currentStep;
  const test = detail.test;
  const [activityOpen, setActivityOpen] = useState(false);

  const {
    runTestsWithAutoFix,
    testFixing,
    pipelineRunning: testPipelineRunning,
    pipelineError,
    clearPipelineError,
  } = useTestPipeline(detail, onChange);

  const autoFixAttemptedRef = useRef(false);

  useEffect(() => {
    autoFixAttemptedRef.current = false;
  }, [run.id]);

  useEffect(() => {
    if (autoFixAttemptedRef.current || !detail.applied || testPipelineRunning) return;
    if (!test || test.ok) return;
    const hasFailures = test.steps?.some((s) => !s.ok && !s.skipped);
    if (!hasFailures) return;
    autoFixAttemptedRef.current = true;
    void runTestsWithAutoFix();
  }, [detail.applied, run.id, test, testPipelineRunning, runTestsWithAutoFix]);

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
    'tests-pipeline',
    testPipelineRunning,
    testFixing ? 'AI agent fixing test failures…' : 'Running tests…',
  );
  useWorkflowBusy(
    'deploy-pipeline',
    pipelineRunning || deployPending || !!detail.deploy?.running,
    'Running local deploy…',
  );

  const prev = previousStep(step);
  const deployDone = step === 'commit' || !!detail.deploy?.ok;
  const testsPassed = test?.ok === true;
  const canContinue = step === 'commit' || (deployDone && testsPassed);

  const changedPaths = detail.output?.files?.map((f) => f.path) ?? [];
  const deployProfile = resolveDeployProfile(
    changedPaths,
    project.defaults.deployProfile ?? 'auto',
  );
  const deployProfileHint = deployProfileReason(deployProfile, changedPaths);

  const defaultChecks = [
    { key: 'php_lint', label: 'PHP Lint' },
    { key: 'static_analysis', label: 'Static Analysis' },
    { key: 'unit_tests', label: 'Unit Tests' },
    { key: 'magento_validate', label: 'Magento Validate' },
  ];
  const checkSteps = test?.steps?.length
    ? test.steps
    : defaultChecks.map((c) => ({ ...c, ok: false, skipped: true, output: '' }));

  return (
    <div className="space-y-4">
      {detail.error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {detail.error}
        </div>
      )}

      <div className={taskPanel}>
        <header className={`${taskPanelHeader} flex items-center justify-between`}>
          <h3 className={taskTitle}>Checks</h3>
          {test && (
            <span
              className={
                test.ok ? 'text-xs font-medium text-emerald-400' : 'text-xs font-medium text-amber-400'
              }
            >
              {test.ok ? 'All passed' : 'Review results'}
            </span>
          )}
        </header>
        <ul className="divide-y divide-slate-700/60">
          {checkSteps.map((s) => (
            <li key={s.key}>
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 marker:content-none">
                  <span className={`text-sm ${taskBody}`}>{s.label}</span>
                  <span className="flex items-center gap-1.5 text-xs font-medium">
                    {s.ok ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        <span className="text-emerald-400">Passed</span>
                      </>
                    ) : s.skipped ? (
                      <>
                        <Circle className={`h-4 w-4 ${taskMuted}`} />
                        <span className={taskMuted}>Pending</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4 text-red-400" />
                        <span className="text-red-400">Failed</span>
                      </>
                    )}
                  </span>
                </summary>
                {s.output ? (
                  <pre className={`mx-4 mb-3 max-h-40 overflow-auto rounded-md ${taskCodeSurface} p-2 text-[11px] ${taskBody}`}>
                    {s.output}
                  </pre>
                ) : null}
              </details>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`${taskPanel} p-4`}>
          <h3 className={`mb-3 ${taskTitle}`}>Run tests</h3>
          <p className={`mb-3 text-xs ${taskMuted}`}>
            Validate PHP lint, static analysis, and Magento standards on applied changes. Failed
            checks are automatically fixed by the AI agent (up to 3 attempts).
          </p>
          <button
            type="button"
            className={taskBtnSecondary}
            disabled={!detail.applied || testPipelineRunning}
            onClick={() => {
              clearPipelineError();
              void runTestsWithAutoFix();
            }}
          >
            {testPipelineRunning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {testFixing ? 'AI fixing tests…' : 'Running tests…'}
              </>
            ) : (
              'Run tests'
            )}
          </button>
          {!detail.applied && (
            <p className="mt-2 text-xs text-amber-300/90">
              Apply code changes on the Review step before running tests.
            </p>
          )}
        </div>

        <div className={`${taskPanel} p-4`}>
          <h3 className={`mb-3 ${taskTitle}`}>Local deploy</h3>
          <p className={`mb-3 text-xs ${taskMuted}`}>
            Run the Magento deployment pipeline in the <strong>php-fpm</strong> container for{' '}
            <span className={taskStrong}>{project.name}</span>.
          </p>
          <div className="mb-3 rounded-md border border-brand-500/25 bg-brand-500/5 px-3 py-2">
            <p className="text-xs font-medium text-brand-300">
              Deploy profile: {DEPLOY_PROFILE_LABELS[deployProfile]}
            </p>
            <p className={`mt-0.5 text-[11px] ${taskMuted}`}>{deployProfileHint}</p>
            {project.defaults.deploySkipComposer && (
              <p className="mt-1 text-[11px] text-amber-300/90">
                Composer install is disabled for this project.
              </p>
            )}
          </div>
          {detail.deploy && !detail.deploy.running && (
            <p className={`mb-2 text-xs ${detail.deploy.ok ? 'text-emerald-400' : 'text-red-400'}`}>
              Last deploy: {detail.deploy.ok ? 'Succeeded' : 'Failed'}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={taskBtnPrimary}
              disabled={pipelineRunning || deployPending || !detail.applied || step !== 'deploy'}
              onClick={() => void runDeployPipeline()}
            >
              {pipelineRunning || deployPending || detail.deploy?.running
                ? 'Deploying…'
                : 'Run local deploy'}
            </button>
            {detail.deploy && !detail.deploy.running && (
              <button
                type="button"
                className={taskBtnGhost}
                onClick={openDeployModal}
              >
                View progress
              </button>
            )}
          </div>
          {step === 'commit' && (
            <p className="mt-2 text-xs text-emerald-400">Deploy complete — ready for PR.</p>
          )}
        </div>
      </div>

      {activities.length > 0 && (
        <div className={taskSurface}>
          <button
            type="button"
            onClick={() => setActivityOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left"
          >
            <span className={`text-sm font-medium ${taskTitle}`}>Recent activity</span>
            <span className={`text-xs ${taskMuted}`}>{activityOpen ? 'Hide' : 'Show'}</span>
          </button>
          {activityOpen && <ActivityFeed items={mapActivities(activities).slice(0, 5)} />}
        </div>
      )}

      {output &&
        ((output.manualTestChecklist?.length ?? 0) > 0 || (output.risks?.length ?? 0) > 0) && (
        <p className={`text-xs ${taskMuted}`}>
          Manual checklist and risks are on the{' '}
          <button
            type="button"
            className={`${taskAccent} hover:underline`}
            onClick={() => onWorkflowTabChange('review')}
          >
            Review
          </button>{' '}
          step.
        </p>
      )}

      {pipelineError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {pipelineError}
        </div>
      )}

      <DeployProgressModal
        open={deployModalOpen}
        detail={detail}
        phase={deployPhase}
        error={deployModalError}
        fixing={deployFixing}
        applying={deployApplying}
        onClose={closeDeployModal}
        onRetry={() => void runDeployPipeline()}
        onProposeFix={() => void runDeployFix()}
        onApplyFix={(paths) => void applyDeployFix(paths)}
        onRedeploy={() => void redeployAfterFix()}
      />

      <div className={taskStickyFooter}>
        {prev ? (
          <button type="button" className={taskBtnGhost} onClick={() => onNavigate(prev)}>
            ← Back
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          className={taskBtnPrimary}
          disabled={!canContinue}
          title={!canContinue ? 'Run tests and local deploy before continuing' : undefined}
          onClick={() => onWorkflowTabChange('pr')}
        >
          Continue to PR
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
