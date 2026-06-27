import { useEffect, useRef } from 'react';
import type { RunDetail, TaskWorkflowStep, TestStep } from '@cpwork/shared';
import { ArrowRight, CheckCircle2, Circle, ImageIcon, Loader2, Wrench, XCircle } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { api, getApiErrorMessage, longRequest } from '../../lib/api';
import { formatStorefrontError, storefrontErrorSummary } from '../../lib/storefrontError';
import { useTestPipeline } from '../../hooks/useTestPipeline';
import { useWorkflowBusy } from '../../context/WorkflowBusyContext';
import { previousStep } from '../task-workflow/constants';
import { migrateStep } from '../task-workflow/constants';
import {
  VisualSmokeScreenshots,
  visualSmokeShotCount,
} from './VisualSmokeScreenshots';
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
  taskTitle,
} from './taskStyles';
import type { WorkflowTab } from './WorkflowTabs';

interface QaStepPanelProps {
  detail: RunDetail;
  onChange: (d: RunDetail) => void;
  onNavigate: (step: TaskWorkflowStep) => void;
  onWorkflowTabChange: (tab: WorkflowTab) => void;
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
  const shotCount = visualSmokeShotCount(s);
  const hasDetails =
    failed ||
    !!s.output ||
    shotCount > 0 ||
    !!s.storefrontError;
  const detailsRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    if (!detailsRef.current) return;
    if (failed || (s.key === 'visual_smoke' && shotCount > 0)) {
      detailsRef.current.open = true;
    }
  }, [failed, s.key, shotCount]);

  const statusBadge = s.ok ? (
    <>
      <CheckCircle2 className="h-4 w-4 text-emerald-400" />
      <span className="text-emerald-400">Passed</span>
    </>
  ) : s.skipped ? (
    <>
      <Circle className={`h-4 w-4 ${taskMuted}`} />
      <span className={taskMuted}>Skipped</span>
    </>
  ) : (
    <>
      <XCircle className="h-4 w-4 text-red-400" />
      <span className="text-red-400">Failed</span>
    </>
  );

  if (!hasDetails) {
    return (
      <li className="flex items-center justify-between px-4 py-3">
        <span className={`text-sm ${taskBody}`}>{s.label}</span>
        <span className="flex items-center gap-1.5 text-xs font-medium">{statusBadge}</span>
      </li>
    );
  }

  return (
    <li>
      <details ref={detailsRef} className="group" open={failed || undefined}>
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 marker:content-none">
          <span className={`min-w-0 flex-1 text-sm ${taskBody}`}>
            {s.label}
            {shotCount > 0 && (
              <span className={`mt-0.5 flex items-center gap-1 text-[11px] ${taskAccent}`}>
                <ImageIcon className="h-3 w-3" />
                {shotCount} screenshot{shotCount === 1 ? '' : 's'} — expand to view
              </span>
            )}
            {failed && s.storefrontError && (
              <span className={`mt-0.5 block truncate text-[11px] text-red-400/90`}>
                {storefrontErrorSummary(s.storefrontError)}
              </span>
            )}
          </span>
          <span className="ml-2 flex shrink-0 items-center gap-1.5 text-xs font-medium">
            {statusBadge}
          </span>
        </summary>

        {failed && s.storefrontError && (
          <div className="mx-4 mb-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-red-300">
              Storefront error
            </p>
            <pre className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-red-200/90">
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
          <pre
            className={`mx-4 mb-3 max-h-48 overflow-auto rounded-md ${taskCodeSurface} p-2 text-[11px] ${taskBody}`}
          >
            {s.output}
          </pre>
        ) : null}

        {s.key === 'visual_smoke' && shotCount > 0 && (
          <VisualSmokeScreenshots
            shots={s.screenshots ?? []}
            history={s.screenshotHistory ?? []}
          />
        )}
      </details>
    </li>
  );
}

export function QaStepPanel({
  detail,
  onChange,
  onNavigate,
  onWorkflowTabChange,
}: QaStepPanelProps) {
  const { run, test, workflow: wf } = detail;
  const step = migrateStep(wf!.currentStep);

  const {
    runTestsWithAutoFix,
    runVisualSmokeFix,
    testFixing,
    pipelineRunning,
    pipelineError,
    clearPipelineError,
  } = useTestPipeline(detail, onChange);

  const completeQaM = useMutation({
    mutationFn: async () =>
      (await api.post<{ detail: RunDetail }>(`/workflow/runs/${run.id}/complete-qa`)).data.detail,
    onSuccess: (d) => {
      onChange(d);
      const nextStep = migrateStep(d.workflow?.currentStep ?? 'done');
      onWorkflowTabChange(nextStep === 'jira_comment' ? 'jira' : 'done');
    },
  });

  useWorkflowBusy(
    'qa-pipeline',
    pipelineRunning,
    testFixing ? 'AI fixing QA failures…' : 'Running QA automation…',
    'PHPUnit, visual smoke, and Playwright project suite.',
  );

  useWorkflowBusy(
    'complete-qa',
    completeQaM.isPending,
    'Completing QA…',
    'Advancing to Jira comment or workflow completion.',
  );

  const defaultChecks: TestStep[] = [
    { key: 'php_lint', label: 'PHP lint', ok: false, skipped: true, output: '' },
    { key: 'phpunit', label: 'PHPUnit', ok: false, skipped: true, output: '' },
    { key: 'visual_smoke', label: 'Visual smoke', ok: false, skipped: true, output: '' },
    { key: 'playwright_suite', label: 'Playwright suite', ok: false, skipped: true, output: '' },
  ];
  const checkSteps = test?.steps?.length ? test.steps : defaultChecks;
  const passed = test?.steps?.filter((s) => s.ok && !s.skipped).length ?? 0;
  const total = test?.steps?.filter((s) => !s.skipped).length ?? 0;
  const prev = previousStep(step);

  return (
    <div className="space-y-4">
      <div className={taskPanel}>
        <header className={`${taskPanelHeader} flex items-center justify-between`}>
          <h3 className={taskTitle}>QA automation</h3>
          {test && (
            <span className={test.ok ? 'text-xs text-emerald-400' : 'text-xs text-amber-400'}>
              {passed}/{total || '—'} passed
            </span>
          )}
        </header>
        <ul className="divide-y divide-slate-700/60">
          {checkSteps.map((s) => (
            <CheckStepRow
              key={s.key}
              step={s}
              canFix={!!test && !test.ok}
              fixing={testFixing}
              onFixVisual={() => {
                clearPipelineError();
                void runVisualSmokeFix();
              }}
            />
          ))}
        </ul>
      </div>

      <div className={`${taskPanel} p-4`}>
        <p className={`mb-3 text-xs ${taskMuted}`}>
          Runs PHPUnit on changed tests, visual smoke screenshots, and{' '}
          <code className="text-slate-300">npx playwright test</code> when a config exists.
          {' '}Expand <span className={taskAccent}>Visual smoke</span> to view storefront screenshots.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={taskBtnPrimary}
            disabled={!detail.applied || pipelineRunning}
            onClick={() => {
              clearPipelineError();
              void runTestsWithAutoFix();
            }}
          >
            {pipelineRunning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Running…
              </>
            ) : (
              'Run QA tests'
            )}
          </button>
          {test && !test.ok && (
            <button
              type="button"
              className={taskBtnSecondary}
              disabled={testFixing || pipelineRunning}
              onClick={() => {
                clearPipelineError();
                void runVisualSmokeFix();
              }}
            >
              <Wrench className="h-4 w-4" />
              Ask AI to fix
            </button>
          )}
        </div>
      </div>

      {(pipelineError || completeQaM.isError) && (
        <p className="text-sm text-red-300">
          {pipelineError ?? getApiErrorMessage(completeQaM.error)}
        </p>
      )}

      {test?.ok && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          QA passed — continue to post a Jira update or finish the task.
        </div>
      )}

      <div className={taskStickyFooter}>
        {prev && (
          <button type="button" className={taskBtnGhost} onClick={() => onNavigate(prev)}>
            ← Back
          </button>
        )}
        {test?.ok && (
          <button
            type="button"
            className={taskBtnPrimary}
            disabled={completeQaM.isPending}
            onClick={() => completeQaM.mutate()}
          >
            {completeQaM.isPending ? 'Continuing…' : run.jiraKey ? 'Continue to Jira' : 'Mark complete'}
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
