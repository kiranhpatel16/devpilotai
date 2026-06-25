import { useEffect, useState } from 'react';
import type { DeployFailureAnalysis, RunDetail, TestReport, TestStep } from '@cpwork/shared';
import { DiffView } from '../DiffView';
import { DEPLOY_PROFILE_LABELS, DEPLOY_STEP_LABELS } from '@cpwork/shared';
import { Loader2 } from 'lucide-react';

export type DeployPipelinePhase = 'deploy' | 'fixing' | 'review' | 'done' | 'failed';

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

function AnalysisPanel({ analysis, lastFixFailed }: { analysis: DeployFailureAnalysis; lastFixFailed?: boolean }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-medium">What went wrong</p>
      <p className="mt-1 text-amber-800">{analysis.summary}</p>
      {lastFixFailed && (
        <p className="mt-2 text-xs font-medium text-red-800">
          The last applied fix did not resolve this error. Click <strong>AI fix error</strong> again —
          a corrected fix will be generated.
        </p>
      )}
      {analysis.issues.length > 0 && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-amber-800">
          {analysis.issues.map((issue) => (
            <li key={`${issue.kind}-${issue.file || issue.module || issue.message}`}>
              {issue.message}
              {issue.file ? ` (${issue.file})` : ''}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-xs text-blue-700">
        Click <strong>AI fix error</strong> to generate a proposed fix. Review the diff, apply when
        ready, then redeploy.
      </p>
    </div>
  );
}

export function DeployProgressModal({
  open,
  detail,
  phase,
  error,
  fixing,
  applying,
  onClose,
  onRetry,
  onProposeFix,
  onApplyFix,
  onRedeploy,
}: {
  open: boolean;
  detail: RunDetail;
  phase: DeployPipelinePhase;
  error: string | null;
  fixing?: boolean;
  applying?: boolean;
  onClose: () => void;
  onRetry?: () => void;
  onProposeFix?: () => void;
  onApplyFix?: (paths: string[]) => void;
  onRedeploy?: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);

  const deploy = detail.deploy as TestReport | null;
  const hasFixProposal = !detail.applied && (detail.diffs?.length ?? 0) > 0;
  const showReview = phase === 'review' && hasFixProposal;

  useEffect(() => {
    const bad = new Set(detail.diffs.filter((d) => d.error).map((d) => d.path));
    setSelected(detail.diffs.map((d) => d.path).filter((p) => !bad.has(p)));
  }, [detail.diffs, detail.output?.summary]);

  if (!open) return null;

  const deployRunning =
    deploy?.running ?? (phase === 'deploy' || phase === 'fixing' || !!applying);
  const deploySteps = deploy?.steps ?? [];
  const runningStepKey = deploy?.runningStep ?? null;
  const completedKeys = new Set(deploySteps.map((s) => s.key));
  const activeStepIndex = deployRunning
    ? deploySteps.findIndex((s) => !s.ok && !s.skipped)
    : -1;
  const failed = phase === 'failed' || (deploy && !deployRunning && !deploy.ok && !showReview);
  const analysis = deploy?.analysis ?? null;
  const lastFixFailed =
    (deploy as { lastFix?: { status?: string } } | null)?.lastFix?.status === 'failed';
  const fixingLabel = 'AI agent is analyzing the error and proposing a fix…';
  const applyingLabel = 'Applying selected fixes…';

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
          {phase === 'fixing' && (
            <div className="flex items-center gap-2 text-sm text-blue-700">
              <div
                className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600"
                role="status"
                aria-label={fixingLabel}
              />
              {fixingLabel}
            </div>
          )}

          {applying && (
            <div className="flex items-center gap-2 text-sm text-blue-700">
              <div
                className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600"
                role="status"
                aria-label={applyingLabel}
              />
              {applyingLabel}
            </div>
          )}

          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Deploy{' '}
              {deployRunning
                ? '· running'
                : deploy?.ok
                  ? '· complete'
                  : failed
                    ? '· failed'
                    : ''}
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
                const isActive = Boolean(deployRunning && index === activeStepIndex);
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

          {failed && analysis && !showReview && (
            <AnalysisPanel analysis={analysis} lastFixFailed={lastFixFailed} />
          )}

          {showReview && (
            <div className="space-y-3 rounded-md border border-blue-200 bg-blue-50 p-3">
              <div>
                <p className="text-sm font-medium text-blue-900">Review AI-proposed fix</p>
              {detail.output?.summary && (
                <p className="mt-1 text-sm text-blue-800">{detail.output.summary}</p>
              )}
              {detail.deploy?.lastFix?.mode === 'auto' && (
                <p className="mt-1 text-xs font-medium text-green-800">
                  Deterministic auto-fix (no AI) — safe to apply and redeploy.
                </p>
              )}
                <p className="mt-1 text-xs text-blue-700">
                  Select files to apply, then redeploy when ready.
                </p>
              </div>

              {detail.diffs.map((d) => (
                <div key={d.path} className="space-y-1">
                  <label className="flex items-center gap-2 text-xs">
                    {!detail.applied && (
                      <input
                        type="checkbox"
                        disabled={!!d.error}
                        checked={selected.includes(d.path)}
                        onChange={(e) =>
                          setSelected((prev) =>
                            e.target.checked
                              ? [...prev, d.path]
                              : prev.filter((p) => p !== d.path),
                          )
                        }
                      />
                    )}
                    <span className="badge bg-slate-100 text-slate-600">{d.action}</span>
                    <span className="font-mono text-slate-700">{d.path}</span>
                    {d.error ? (
                      <span className="badge bg-red-100 text-red-700">could not match</span>
                    ) : (
                      <>
                        <span className="text-green-600">+{d.added}</span>
                        <span className="text-red-600">-{d.removed}</span>
                      </>
                    )}
                  </label>
                  {d.error ? (
                    <p className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                      {d.error}
                    </p>
                  ) : (
                    <DiffView diff={d} />
                  )}
                </div>
              ))}
            </div>
          )}

          {(error || deploy?.error) && !(failed && analysis) && (
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

        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 px-4 py-3">
          {deployRunning && (
            <p className="mr-auto self-center text-xs text-slate-500">
              This may take several minutes. Keep this window open.
            </p>
          )}

          {showReview && !deployRunning && (
            <>
              {onProposeFix && !detail.applied && (
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={applying || fixing}
                  onClick={onProposeFix}
                >
                  {fixing ? 'Regenerating…' : 'Regenerate fix'}
                </button>
              )}
              {onApplyFix && !detail.applied && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={applying || fixing || selected.length === 0}
                  onClick={() => onApplyFix(selected)}
                >
                  {applying ? 'Applying…' : `Apply ${selected.length} file(s)`}
                </button>
              )}
              {detail.applied && onRedeploy && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={fixing || applying}
                  onClick={onRedeploy}
                >
                  Redeploy
                </button>
              )}
              <button type="button" className="btn-secondary" onClick={onClose}>
                Close
              </button>
            </>
          )}

          {failed && !deployRunning && !showReview && (
            <>
              {onRetry && (
                <button type="button" className="btn-secondary" onClick={onRetry}>
                  Retry deploy
                </button>
              )}
              {onProposeFix && (
                <button
                  type="button"
                  className="btn-primary"
                  disabled={fixing}
                  onClick={onProposeFix}
                >
                  {fixing ? 'Generating fix…' : 'AI fix error'}
                </button>
              )}
              <button type="button" className="btn-secondary" onClick={onClose}>
                Close
              </button>
            </>
          )}

          {phase === 'done' && (
            <button type="button" className="btn-primary" onClick={onClose}>
              Continue
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
