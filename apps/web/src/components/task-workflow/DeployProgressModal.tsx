import type { RunDetail, TestReport, TestStep } from '@cpwork/shared';

export type DeployPipelinePhase = 'deploy' | 'done' | 'failed';

function stepIcon(step: TestStep, isActive: boolean): string {
  if (isActive) return '…';
  if (step.skipped) return '○';
  return step.ok ? '✓' : '✗';
}

function stepClass(step: TestStep, isActive: boolean): string {
  if (isActive) return 'text-blue-600';
  if (step.skipped) return 'text-slate-400';
  return step.ok ? 'text-green-600' : 'text-red-600';
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
  const activeStepIndex = deployRunning
    ? deploySteps.findIndex((s) => !s.ok && !s.skipped)
    : -1;
  const failed = phase === 'failed' || (deploy && !deployRunning && !deploy.ok);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="card flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-800">Local deployment</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Magento deploy inside php-fpm. Commit, push, and PR are done manually on the next step.
          </p>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Deploy {deployRunning ? '· running' : deploy?.ok ? '· complete' : failed ? '· failed' : ''}
            </h3>
            <ul className="mt-2 space-y-1">
              {deploySteps.length === 0 && deployRunning && (
                <li className="text-sm text-blue-600">Starting deployment…</li>
              )}
              {deploySteps.map((step, index) => {
                const isActive = deployRunning && index === activeStepIndex;
                return (
                  <li key={step.key} className="rounded-md border border-slate-200">
                    <details open={isActive || !step.ok}>
                      <summary className="cursor-pointer px-3 py-2 text-sm">
                        <span className={stepClass(step, isActive)}>
                          {stepIcon(step, isActive)} {step.label}
                        </span>
                      </summary>
                      {step.output && (
                        <pre className="max-h-40 overflow-auto bg-slate-900 p-2 text-[11px] text-slate-200">
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
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error || deploy?.error}
            </div>
          )}

          {phase === 'done' && deploy?.ok && (
            <p className="text-sm text-green-700">
              Deploy finished successfully. Continue on the commit step to push your changes.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
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
