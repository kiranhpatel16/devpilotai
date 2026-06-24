import { useEffect, useState } from 'react';
import type { DeployFailureAnalysis, RunDetail, TestReport, TestStep } from '@cpwork/shared';
import { DiffView } from '../DiffView';

export type DeployPipelinePhase = 'deploy' | 'fixing' | 'review' | 'done' | 'failed';

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
  const activeStepIndex = deployRunning
    ? deploySteps.findIndex((s) => !s.ok && !s.skipped)
    : -1;
  const failed = phase === 'failed' || (deploy && !deployRunning && !deploy.ok && !showReview);
  const analysis = deploy?.analysis ?? null;
  const lastFixFailed =
    (deploy as { lastFix?: { status?: string } } | null)?.lastFix?.status === 'failed';
  const fixingLabel = 'AI agent is analyzing the error and proposing a fix…';
  const applyingLabel = 'Applying selected fixes…';

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
              {deploySteps.length === 0 && deployRunning && (
                <li className="text-sm text-blue-600">Starting deployment…</li>
              )}
              {deploySteps.map((step, index) => {
                const isActive = Boolean(deployRunning && index === activeStepIndex);
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
