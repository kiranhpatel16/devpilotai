import { useEffect, useRef, useState } from 'react';
import type {
  Activity,
  Project,
  RunDetail,
  TaskWorkflowStep,
  TestScreenshot,
  TestStep,
} from '@cpwork/shared';
import {
  DEPLOY_PROFILE_LABELS,
  deployProfileReason,
  resolveDeployProfile,
} from '@cpwork/shared';
import { ArrowRight, CheckCircle2, Circle, Loader2, Wrench, XCircle } from 'lucide-react';
import { useDeployPipeline } from '../../hooks/useDeployPipeline';
import { useTestPipeline } from '../../hooks/useTestPipeline';
import { useWorkflowBusy } from '../../context/WorkflowBusyContext';
import { getDeployBusyDetail } from '../../lib/workflowStatus';
import { formatStorefrontError, storefrontErrorSummary } from '../../lib/storefrontError';
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
  taskWarningText,
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

function ScreenshotGrid({ shots, heading }: { shots: TestScreenshot[]; heading?: string }) {
  if (!shots.length) return null;
  return (
    <div className="mx-4 mb-3">
      {heading && (
        <p className={`mb-2 text-[11px] font-medium uppercase tracking-wide ${taskMuted}`}>{heading}</p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {shots.map((shot) => (
          <figure
            key={shot.path}
            className="overflow-hidden rounded-md border border-slate-700/60 bg-slate-900/40"
          >
            <a href={`/api${shot.path}`} target="_blank" rel="noreferrer">
              <img
                src={`/api${shot.path}`}
                alt={shot.label}
                className="max-h-64 w-full object-cover object-top"
              />
            </a>
            <figcaption className={`px-2 py-1.5 text-[11px] ${taskMuted}`}>
              {shot.label}
              {shot.url ? ` — ${shot.url}` : ''}
              {shot.capturedAt
                ? ` · ${new Date(shot.capturedAt * 1000).toLocaleString()}`
                : ''}
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function CheckStepRow({
  step: s,
  onFixVisual,
  fixing,
  canFix,
}: {
  step: TestStep;
  onFixVisual?: () => void;
  fixing?: boolean;
  canFix?: boolean;
}) {
  const failed = !s.ok && !s.skipped;
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (failed && detailsRef.current) {
      detailsRef.current.open = true;
    }
  }, [failed, s.key]);

  return (
    <li>
      <details ref={detailsRef} className="group" open={failed || undefined}>
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 marker:content-none">
          <span className={`min-w-0 flex-1 text-sm ${taskBody}`}>
            {s.label}
            {failed && s.storefrontError && (
              <span className={`mt-0.5 block truncate text-[11px] text-red-400/90`}>
                {storefrontErrorSummary(s.storefrontError)}
              </span>
            )}
          </span>
          <span className="ml-2 flex shrink-0 items-center gap-1.5 text-xs font-medium">
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

        {failed && s.storefrontError && (
          <div className="mx-4 mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
            <p className={`text-xs font-semibold uppercase tracking-wide text-red-300`}>
              Storefront error
            </p>
            <pre className={`mt-2 whitespace-pre-wrap text-xs leading-relaxed text-red-200/90`}>
              {formatStorefrontError(s.storefrontError)}
            </pre>
            {s.key === 'visual_smoke' && canFix && onFixVisual && (
              <button
                type="button"
                className={`${taskBtnSecondary} mt-3`}
                disabled={fixing}
                onClick={onFixVisual}
              >
                {fixing ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    AI fixing…
                  </>
                ) : (
                  <>
                    <Wrench className="h-4 w-4" />
                    Fix with AI
                  </>
                )}
              </button>
            )}
          </div>
        )}

        {s.output ? (
          <pre className={`mx-4 mb-3 max-h-48 overflow-auto rounded-md ${taskCodeSurface} p-2 text-[11px] ${taskBody}`}>
            {s.output}
          </pre>
        ) : null}

        <ScreenshotGrid shots={s.screenshots ?? []} heading="Latest screenshots" />
        <ScreenshotGrid shots={s.screenshotHistory ?? []} heading="Previous screenshots" />
      </details>
    </li>
  );
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
    runVisualSmokeFix,
    hasVisualSmokeFailure,
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
    testFixing
      ? 'The QA Agent is proposing fixes for failing checks including storefront errors.'
      : 'Running PHP lint, PHPUnit, and browser screenshot checks on your local environment.',
  );
  useWorkflowBusy(
    'deploy-pipeline',
    pipelineRunning || deployPending || !!detail.deploy?.running,
    'Running local deploy…',
    getDeployBusyDetail(detail.deploy) ?? 'Magento setup — composer, upgrade, cache, and related steps.',
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

  const defaultChecks: TestStep[] = [
    { key: 'php_lint', label: 'PHP Lint (changed files)', ok: false, skipped: true, output: '' },
    { key: 'phpunit', label: 'PHPUnit (changed tests only)', ok: false, skipped: true, output: '' },
    { key: 'visual_smoke', label: 'Visual smoke (screenshots)', ok: false, skipped: true, output: '' },
    { key: 'di_compile', label: 'DI compile', ok: false, skipped: true, output: '' },
  ];
  const checkSteps: TestStep[] = test?.steps?.length ? test.steps : defaultChecks;

  const visualStep = checkSteps.find((s) => s.key === 'visual_smoke');
  const showVisualFixBanner =
    hasVisualSmokeFailure && visualStep?.storefrontError && detail.applied;

  return (
    <div className="space-y-4">
      {detail.error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {detail.error}
        </div>
      )}

      {showVisualFixBanner && visualStep?.storefrontError && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
          <p className={`text-sm font-semibold ${taskWarningText}`}>Homepage / storefront check failed</p>
          <p className={`mt-1 text-sm ${taskBody}`}>
            Magento returned an error when loading the storefront. The failing file is likely{' '}
            <code className="rounded bg-slate-800/60 px-1 text-xs">
              {visualStep.storefrontError.file ?? 'in changed layout/template files'}
            </code>
            .
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className={taskBtnPrimary}
              disabled={testPipelineRunning}
              onClick={() => {
                clearPipelineError();
                void runVisualSmokeFix();
              }}
            >
              {testFixing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Fixing…
                </>
              ) : (
                <>
                  <Wrench className="h-4 w-4" />
                  Fix with AI
                </>
              )}
            </button>
            <button
              type="button"
              className={taskBtnSecondary}
              onClick={() => onWorkflowTabChange('review')}
            >
              Open in Review
            </button>
            <button
              type="button"
              className={taskBtnGhost}
              onClick={() => onWorkflowTabChange('code')}
            >
              View code changes
            </button>
          </div>
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
            <CheckStepRow
              key={s.key}
              step={s}
              canFix={detail.applied}
              fixing={testFixing}
              onFixVisual={
                s.key === 'visual_smoke' && hasVisualSmokeFailure
                  ? () => {
                      clearPipelineError();
                      void runVisualSmokeFix();
                    }
                  : undefined
              }
            />
          ))}
        </ul>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className={`${taskPanel} p-4`}>
          <h3 className={`mb-3 ${taskTitle}`}>Run tests</h3>
          <p className={`mb-3 text-xs ${taskMuted}`}>
            PHP lint runs on changed files only. PHPUnit runs only when Test/Unit files changed.
            Visual smoke opens your storefront, captures screenshots, and parses Magento errors.
            Failed checks can be auto-fixed by the AI agent (up to 3 attempts).
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
            <p className={`mt-2 text-xs text-amber-300/90`}>
              Apply code changes on the Review step before running tests.
            </p>
          )}
          {hasVisualSmokeFailure && detail.applied && (
            <p className={`mt-2 text-xs ${taskMuted}`}>
              Previous screenshots are kept until checks pass. Expand Visual smoke for details.
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

      {!canContinue && test && !test.ok && (
        <p className={`text-xs ${taskMuted}`}>
          Fix failing checks above before continuing to PR.
          {hasVisualSmokeFailure && ' Use Fix with AI for storefront/XML errors.'}
        </p>
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
        onProposeFix={(instructions) => void runDeployFix(instructions)}
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
          title={
            !canContinue
              ? test && !test.ok
                ? 'Fix failing checks before continuing'
                : 'Run tests and local deploy before continuing'
              : undefined
          }
          onClick={() => onWorkflowTabChange('pr')}
        >
          Continue to PR
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
