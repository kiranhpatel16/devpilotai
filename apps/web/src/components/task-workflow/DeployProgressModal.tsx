import type { RunDetail, TestReport, TestStep } from '@cpwork/shared';
import { DEPLOY_PROFILE_LABELS, DEPLOY_STEP_LABELS } from '@cpwork/shared';
import { Loader2 } from 'lucide-react';

export type DeployPipelinePhase = 'deploy' | 'done' | 'failed';

function stepIcon(step: TestStep, isActive: boolean): string {
  if (isActive) return '…';
  if (step.skipped) return '○';
  return step.ok ? '✓' : '✗';
}

function stepClass(step: TestStep, isActive: boolean): string {
  if (isActive) return 'text-brand-400';
  if (step.skipped) return 'text-slate-500';
  return step.ok ? 'text-emerald-400' : 'text-red-400';
}

export function DeployProgressModal({
  open,
  detail,
  phase,
  error,
  onClose,
}: {
  open: boolean;
  detail: RunDetail;
  phase: DeployPipelinePhase;
  error: string | null;
  onClose: () => void;
}) {
  if (!open) return null;

  const deploy = detail.deploy as TestReport | null;
  const deployRunning = deploy?.running ?? phase === 'deploy';
  const deploySteps = deploy?.steps ?? [];
  const runningStepKey = deploy?.runningStep ?? null;
  const completedKeys = new Set(deploySteps.map((s) => s.key));
  const activeStepIndex = deployRunning
    ? deploySteps.findIndex((s) => !s.ok && !s.skipped)
    : -1;
  const failed = phase === 'failed' || (deploy && !deployRunning && !deploy.ok);

  const runningLabel =
    runningStepKey && DEPLOY_STEP_LABELS[runningStepKey]
      ? DEPLOY_STEP_LABELS[runningStepKey]
      : runningStepKey;

  const showRunningRow =
    deployRunning &&
    runningStepKey &&
    !completedKeys.has(runningStepKey) &&
    activeStepIndex < 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-slate-700/60 bg-[#12121f] shadow-xl">
        <div className="border-b border-slate-700/60 px-4 py-3">
          <h2 className="text-base font-semibold text-white">Local deployment</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Magento deploy inside php-fpm. Commit, push, and PR are done manually on the next step.
          </p>
          {deploy?.profile && (
            <p className="mt-2 text-xs text-brand-300">
              Profile: {DEPLOY_PROFILE_LABELS[deploy.profile]}
            </p>
          )}
          {deploy?.profileReason && (
            <p className="mt-0.5 text-[11px] text-slate-500">{deploy.profileReason}</p>
          )}
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Deploy {deployRunning ? '· running' : deploy?.ok ? '· complete' : failed ? '· failed' : ''}
            </h3>
            <ul className="mt-2 space-y-1">
              {showRunningRow && (
                <li className="rounded-md border border-brand-500/40 bg-brand-500/10">
                  <div className="flex items-center gap-2 px-3 py-2 text-sm text-brand-300">
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                    <span>{runningLabel} — running…</span>
                  </div>
                </li>
              )}
              {deploySteps.length === 0 && deployRunning && !showRunningRow && (
                <li className="flex items-center gap-2 text-sm text-brand-300">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Starting deployment…
                </li>
              )}
              {deploySteps.map((step, index) => {
                const isActive =
                  deployRunning &&
                  (index === activeStepIndex ||
                    (runningStepKey === step.key && !step.ok && !step.skipped));
                return (
                  <li key={step.key} className="rounded-md border border-slate-700/60">
                    <details open={isActive || !step.ok || step.skipped}>
                      <summary className="cursor-pointer px-3 py-2 text-sm text-slate-200">
                        <span className={`inline-flex items-center gap-1.5 ${stepClass(step, isActive)}`}>
                          {isActive && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          <span>
                            {stepIcon(step, isActive)} {step.label}
                          </span>
                          {step.skipped && (
                            <span className="text-[10px] font-normal text-slate-500">(skipped)</span>
                          )}
                        </span>
                      </summary>
                      {step.output && (
                        <pre className="max-h-48 overflow-auto bg-[#0a0a12] p-2 text-[11px] text-slate-300">
                          {step.output}
                        </pre>
                      )}
                    </details>
                  </li>
                );
              })}
            </ul>
          </section>

          {(error || deploy?.error) && (
            <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
              {error || deploy?.error}
            </div>
          )}

          {phase === 'done' && deploy?.ok && (
            <p className="text-sm text-emerald-400">
              Deploy finished successfully. Continue on the PR step to push your changes.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-700/60 px-4 py-3">
          {(failed || phase === 'done') && (
            <button type="button" className="btn-primary" onClick={onClose}>
              {phase === 'done' ? 'Continue' : 'Close'}
            </button>
          )}
          {deployRunning && (
            <p className="mr-auto self-center text-xs text-slate-500">
              This may take several minutes. Keep this window open.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
