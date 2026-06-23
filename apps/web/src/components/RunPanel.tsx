import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { RunDetail } from '@cpwork/shared';
import { api, getApiErrorCode, getApiErrorMessage } from '../lib/api';
import { DiffView } from './DiffView';

const STATUS_LABELS: Record<string, string> = {
  branching: 'Creating branch…',
  analyzing: 'Analyzing…',
  awaiting_review: 'Awaiting review',
  testing: 'Applied — ready to test',
  commit_ready: 'Tests passed — ready to commit',
  pushing: 'Committed — ready to push',
  pr_creating: 'Pushed — ready for PR',
  done: 'Done',
  failed: 'Failed',
};

export function RunPanel({
  detail,
  onChange,
}: {
  detail: RunDetail;
  onChange: (d: RunDetail) => void;
}) {
  const { run, output } = detail;
  const [selected, setSelected] = useState<string[]>([]);
  const [commitMessage, setCommitMessage] = useState('');
  const [refineText, setRefineText] = useState('');
  const [actionError, setActionError] = useState<{ message: string; code?: string } | null>(null);

  useEffect(() => {
    const bad = new Set(detail.diffs.filter((d) => d.error).map((d) => d.path));
    setSelected(output?.files.map((f) => f.path).filter((p) => !bad.has(p)) ?? []);
    if (run.jiraKey && output?.summary) {
      setCommitMessage(`${run.jiraKey}: ${output.summary}`);
    } else if (output?.summary) {
      setCommitMessage(output.summary);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.id, output?.summary, detail.diffs.length]);

  function useRunAction(path: string, getBody?: () => unknown) {
    return useMutation({
      mutationFn: async () =>
        (await api.post(`/runs/${run.id}/${path}`, getBody ? getBody() : undefined)).data
          .detail as RunDetail,
      onMutate: () => setActionError(null),
      onSuccess: (d) => {
        onChange(d);
        setRefineText('');
      },
      onError: (err) =>
        setActionError({ message: getApiErrorMessage(err), code: getApiErrorCode(err) }),
    });
  }

  // Hooks called unconditionally in a stable order every render.
  const applyM = useRunAction('apply', () => ({ paths: selected }));
  const refineM = useRunAction('refine', () => ({ instructions: refineText }));
  const revertM = useRunAction('revert');
  const testM = useRunAction('test');
  const commitM = useRunAction('commit', () => ({ message: commitMessage }));
  const pushM = useRunAction('push');
  const prM = useRunAction('pr');

  const isAgent = run.mode === 'agent' || run.mode === 'workflow';
  const git = detail.git;

  return (
    <div className="card space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">
          Run · <span className="font-mono text-brand-700">{run.provider}</span>
          {run.model && <span className="text-slate-400"> / {run.model}</span>}
        </h2>
        <span className="badge bg-slate-100 text-slate-600">
          {STATUS_LABELS[run.status] ?? run.status}
        </span>
      </div>

      {detail.error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
          <p className="font-semibold">Run failed</p>
          <p>{detail.error}</p>
        </div>
      )}

      {output?.summary && (
        <div>
          <p className="text-sm font-medium text-slate-800">{output.summary}</p>
        </div>
      )}

      {/* Non-agent text answer (plan/debug/ask) */}
      {!isAgent && output?.text && (
        <div className="space-y-2">
          {detail.planFilePath && (
            <p className="text-xs text-slate-500">
              Saved to <code className="rounded bg-slate-100 px-1">{detail.planFilePath}</code>
            </p>
          )}
          <pre className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-xs text-slate-700">
            {output.text}
          </pre>
        </div>
      )}

      {detail.usage && (
        <p className="text-xs text-slate-400">
          {detail.usage.latencyMs} ms
          {detail.usage.inputTokens != null &&
            ` · ${detail.usage.inputTokens}→${detail.usage.outputTokens ?? '?'} tokens`}
        </p>
      )}

      {/* Follow-up: refine the current proposal before applying */}
      {isAgent && output && !detail.applied && (
        <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
          <label className="label">Add or change something in this implementation</label>
          <div className="flex items-start gap-2">
            <textarea
              className="input min-h-[60px]"
              placeholder="e.g. also wrap the H2 in a container, and keep the existing footer links"
              value={refineText}
              onChange={(e) => setRefineText(e.target.value)}
            />
            <button
              className="btn-secondary whitespace-nowrap"
              disabled={refineM.isPending || !refineText.trim()}
              onClick={() => refineM.mutate()}
            >
              {refineM.isPending ? 'Updating…' : 'Update changes'}
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Re-runs the agent with your follow-up on top of the current proposal.
          </p>
        </div>
      )}

      {/* Agent: file diffs + apply */}
      {isAgent && detail.diffs.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Proposed changes ({detail.diffs.length})
            </h3>
            {!detail.applied && (
              <button
                className="btn-primary"
                disabled={applyM.isPending || selected.length === 0}
                onClick={() => applyM.mutate()}
              >
                {applyM.isPending ? 'Applying…' : `Apply ${selected.length} file(s)`}
              </button>
            )}
            {detail.applied && (
              <div className="flex items-center gap-2">
                <span className="badge bg-green-100 text-green-700">Applied</span>
                {detail.canRevert && (
                  <button
                    className="btn-ghost text-red-600"
                    disabled={revertM.isPending}
                    onClick={() => revertM.mutate()}
                    title="Restore files to their state before applying"
                  >
                    {revertM.isPending ? 'Reverting…' : 'Revert changes'}
                  </button>
                )}
              </div>
            )}
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
              {d.reason && <p className="pl-6 text-xs text-slate-400">{d.reason}</p>}
              {d.error ? (
                <p className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                  ⚠ {d.error} Use the follow-up box above to clarify, or Refine the request.
                </p>
              ) : (
                <DiffView diff={d} />
              )}
            </div>
          ))}
        </div>
      )}

      {isAgent && output && detail.diffs.length === 0 && (
        <p className="text-sm text-slate-500">The AI proposed no file changes.</p>
      )}

      {/* Test results */}
      {detail.test && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Tests {detail.test.ok ? '✅' : '❌'}
          </h3>
          {detail.test.steps.map((s) => (
            <details key={s.key} className="rounded-md border border-slate-200">
              <summary className="cursor-pointer px-3 py-1.5 text-xs">
                <span
                  className={
                    s.skipped ? 'text-slate-400' : s.ok ? 'text-green-600' : 'text-red-600'
                  }
                >
                  {s.skipped ? '○' : s.ok ? '✓' : '✗'} {s.label}
                </span>
              </summary>
              <pre className="overflow-x-auto bg-slate-900 p-2 text-[11px] text-slate-200">
                {s.output}
              </pre>
            </details>
          ))}
        </div>
      )}

      {/* Pipeline actions (agent only, after apply) */}
      {isAgent && detail.applied && (
        <div className="space-y-3 border-t border-slate-100 pt-3">
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary"
              disabled={testM.isPending}
              onClick={() => testM.mutate()}
            >
              {testM.isPending ? 'Testing…' : 'Run tests'}
            </button>
          </div>

          <div>
            <label className="label">Commit message</label>
            <input
              className="input font-mono text-xs"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn-secondary"
              disabled={commitM.isPending || !commitMessage.trim() || git?.committed}
              onClick={() => commitM.mutate()}
            >
              {git?.committed ? 'Committed ✓' : commitM.isPending ? 'Committing…' : 'Commit'}
            </button>
            <button
              className="btn-secondary"
              disabled={pushM.isPending || !git?.committed || git?.pushed}
              onClick={() => pushM.mutate()}
            >
              {git?.pushed ? 'Pushed ✓' : pushM.isPending ? 'Pushing…' : 'Push'}
            </button>
            <button
              className="btn-primary"
              disabled={prM.isPending || !git?.pushed}
              onClick={() => prM.mutate()}
            >
              {prM.isPending ? 'Opening PR…' : 'Create staging PR'}
            </button>
          </div>

          {git?.prUrl && (
            <a
              href={git.prUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-sm font-medium text-brand-600 hover:underline"
            >
              View pull request ↗
            </a>
          )}
        </div>
      )}

      {/* Manual checklist + risks */}
      {output && (output.manualTestChecklist.length > 0 || output.risks.length > 0) && (
        <div className="grid gap-3 border-t border-slate-100 pt-3 md:grid-cols-2">
          {output.manualTestChecklist.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Manual checklist
              </h3>
              <ul className="mt-1 space-y-1 text-xs text-slate-600">
                {output.manualTestChecklist.map((c, i) => (
                  <li key={i}>☐ {c}</li>
                ))}
              </ul>
            </div>
          )}
          {output.risks.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Risks
              </h3>
              <ul className="mt-1 space-y-1 text-xs text-amber-700">
                {output.risks.map((r, i) => (
                  <li key={i}>⚠ {r}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {actionError && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <p className="font-medium">{actionError.message}</p>
          {['gh_missing', 'pr_not_configured', 'pr_token_missing', 'pr_username_missing'].includes(
            actionError.code ?? '',
          ) && (
            <p className="mt-1 text-xs">
              Configure Git/PR credentials in Admin → Projects (PR provider, repo owner/name, API
              token). Or open the PR manually for branch <code>{run.branchName}</code>.
            </p>
          )}
          {actionError.code === 'gh_missing' && (
            <p className="mt-1 text-xs">
              Legacy fallback: install GitHub CLI (`gh`) and run `gh auth login`.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
