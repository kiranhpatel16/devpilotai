import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { RunDetail, TaskWorkflowStep } from '@cpwork/shared';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { api, getApiErrorMessage, longRequest } from '../../lib/api';
import { useWorkflowBusy } from '../../context/WorkflowBusyContext';
import { DiffView } from '../DiffView';
import { previousStep } from '../task-workflow/constants';
import {
  fileActionBadgeClass,
  fileListItemClass,
  filePathTextClass,
  taskAccent,
  taskAccentHover,
  taskBody,
  taskBtnGhost,
  taskBtnPrimary,
  taskBtnSecondary,
  taskCodeSurface,
  taskInput,
  taskMuted,
  taskPanel,
  taskRiskItem,
  taskStickyFooter,
  taskStrong,
  taskSurface,
  taskTitle,
  taskWarningText,
} from './taskStyles';

interface ReviewStepPanelProps {
  detail: RunDetail;
  userNotes?: string | null;
  onChange: (d: RunDetail) => void;
  onNavigate: (step: TaskWorkflowStep) => void;
  onWorkflowTabChange?: (tab: 'tests') => void;
}

function statusBadge(action: string, selected = false) {
  return { label: statusBadgeLabel(action), className: fileActionBadgeClass(action, selected) };
}

function statusBadgeLabel(action: string): string {
  const a = action.toLowerCase();
  if (a === 'create') return 'A';
  if (a === 'delete') return 'D';
  return 'M';
}

export function ReviewStepPanel({
  detail,
  userNotes,
  onChange,
  onNavigate,
  onWorkflowTabChange,
}: ReviewStepPanelProps) {
  const { run, output } = detail;
  const wf = detail.workflow!;
  const step = wf.currentStep;
  const canApprove = step === 'code_review';

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [refineText, setRefineText] = useState('');
  const [viewMode, setViewMode] = useState<'diff' | 'file'>('diff');
  const [metaOpen, setMetaOpen] = useState(false);
  const [actionError, setActionError] = useState<{ message: string; code?: string } | null>(null);

  const diffs = detail.diffs ?? [];
  const files = output?.files ?? [];
  const manualTestChecklist = output?.manualTestChecklist ?? [];
  const risks = output?.risks ?? [];
  const validationErrors = output?.validationErrors ?? [];
  const validationWarnings = output?.validationWarnings ?? [];
  const diffErrors = diffs
    .filter((d) => d.error)
    .map((d) => `${d.path}: ${d.error}`);
  const hasBlockingIssues = validationErrors.length > 0 || diffErrors.length > 0;
  const activePath = selectedPath ?? files[0]?.path ?? diffs[0]?.path ?? null;
  const selectedDiff = diffs.find((d) => d.path === activePath) ?? diffs[0];
  const activeFile = files.find((f) => f.path === activePath);

  useEffect(() => {
    const bad = new Set(diffs.filter((d) => d.error).map((d) => d.path));
    setSelected(files.map((f) => f.path).filter((p) => !bad.has(p)));
    setSelectedPath(null);
  }, [run.id, diffs.length, files.length]);

  const applyM = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/runs/${run.id}/apply`, { paths: selected })
      ).data.detail as RunDetail,
    onMutate: () => setActionError(null),
    onSuccess: (d) => onChange(d),
    onError: (err) => setActionError({ message: getApiErrorMessage(err) }),
  });

  const refineM = useMutation({
    mutationFn: async () =>
      (
        await api.post(`/runs/${run.id}/refine`, { instructions: refineText }, longRequest)
      ).data.detail as RunDetail,
    onMutate: () => setActionError(null),
    onSuccess: (d) => {
      onChange(d);
      setRefineText('');
    },
    onError: (err) => setActionError({ message: getApiErrorMessage(err) }),
  });

  const revertM = useMutation({
    mutationFn: async () =>
      (await api.post(`/runs/${run.id}/revert`)).data.detail as RunDetail,
    onMutate: () => setActionError(null),
    onSuccess: (d) => onChange(d),
    onError: (err) => setActionError({ message: getApiErrorMessage(err) }),
  });

  const approveM = useMutation({
    mutationFn: async () =>
      (await api.post<{ detail: RunDetail }>(`/workflow/runs/${run.id}/approve-code`)).data.detail,
    onSuccess: (d) => {
      onChange(d);
      onWorkflowTabChange?.('tests');
    },
    onError: (err) => setActionError({ message: getApiErrorMessage(err) }),
  });

  useWorkflowBusy('apply-changes', applyM.isPending, 'Applying changes…', 'Writing approved AI file changes to your local project.');
  useWorkflowBusy('refine-code', refineM.isPending, 'Updating changes…', 'The Developer Agent is revising code based on your feedback.');
  useWorkflowBusy('revert-changes', revertM.isPending, 'Reverting changes…', 'Restoring files to their state before the last agent proposal.');
  useWorkflowBusy('approve-code-review', approveM.isPending, 'Approving code…', 'Moving to the Tests step to run PHPUnit and validation.');

  const prev = previousStep(step);
  const hasChecklist = manualTestChecklist.length > 0 || risks.length > 0;

  if (!output) {
    return (
      <p className={`py-12 text-center text-sm ${taskMuted}`}>
        No proposed changes yet. Complete the Code step first.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {output.summary && (
        <p className={`${taskSurface} px-4 py-3 text-sm ${taskBody}`}>
          {output.summary}
        </p>
      )}

      {userNotes?.trim() && (
        <div className={`${taskSurface} px-4 py-3`}>
          <h3 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${taskMuted}`}>
            Your notes
          </h3>
          <p className={`text-sm leading-relaxed whitespace-pre-wrap ${taskBody}`}>
            {userNotes.trim()}
          </p>
        </div>
      )}

      {(detail.error || hasBlockingIssues) && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-950/40">
          <p className={`text-sm font-semibold ${taskWarningText}`}>
            {detail.error ? 'Review before apply' : 'Issues to fix before apply'}
          </p>
          {detail.error && (
            <p className={`mt-1 text-sm ${taskBody}`}>{detail.error}</p>
          )}
          {!detail.error && validationErrors.length > 0 && (
            <p className={`mt-1 text-xs ${taskBody}`}>
              Some files still contain stub or incomplete code. Use Request changes below, then apply
              when resolved.
            </p>
          )}
          {(validationErrors.length > 0 || diffErrors.length > 0) && (
            <ul className="mt-2 space-y-1.5">
              {[...validationErrors, ...diffErrors].map((msg) => (
                <li key={msg} className={taskRiskItem}>
                  {msg}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {validationWarnings.length > 0 && (
        <div className={`${taskSurface} p-3`}>
          <p className={`text-sm font-semibold ${taskTitle}`}>Suggestions</p>
          <ul className="mt-2 space-y-1.5">
            {validationWarnings.map((msg) => (
              <li key={msg} className={`text-xs leading-relaxed ${taskBody}`}>
                • {msg}
              </li>
            ))}
          </ul>
        </div>
      )}

      {diffs.length === 0 ? (
        <p className={`text-sm ${taskMuted}`}>The AI proposed no file changes.</p>
      ) : (
        <div
          className={`${taskPanel} grid min-h-[60vh] overflow-hidden lg:grid-cols-[240px_1fr]`}
        >
          <div className="flex flex-col border-b border-slate-200 dark:border-neutral-800/60 lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-neutral-800/60 px-3 py-2.5">
              <div>
                <h3 className={taskTitle}>Files ({files.length})</h3>
                {!detail.applied && files.length > 0 && (
                  <p className={`mt-0.5 text-[10px] ${taskMuted}`}>
                    {selected.length} selected
                    {selected.length !== files.length ? ` of ${files.length}` : ''}
                  </p>
                )}
              </div>
              {!detail.applied && (
                <button
                  type="button"
                  className={`${taskBtnPrimary} px-2 py-1 text-xs`}
                  disabled={applyM.isPending || selected.length === 0 || hasBlockingIssues}
                  title={
                    hasBlockingIssues
                      ? 'Fix quality issues before applying'
                      : selected.length === 0
                        ? 'Select at least one file'
                        : undefined
                  }
                  onClick={() => applyM.mutate()}
                >
                  {applyM.isPending ? '…' : `Apply ${selected.length}`}
                </button>
              )}
              {detail.applied && (
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-400">
                  Applied
                </span>
              )}
            </div>
            <ul className="flex-1 overflow-y-auto p-2">
              {files.map((f) => {
                const isActive = activePath === f.path;
                const badge = statusBadge(f.action ?? 'modify', isActive);
                const diff = diffs.find((d) => d.path === f.path);
                return (
                  <li key={f.path}>
                    <button
                      type="button"
                      onClick={() => setSelectedPath(f.path)}
                      className={fileListItemClass(isActive)}
                      aria-current={isActive ? 'true' : undefined}
                    >
                      {!detail.applied && (
                        <input
                          type="checkbox"
                          className="mt-0.5 accent-brand-600"
                          disabled={!!diff?.error}
                          checked={selected.includes(f.path)}
                          onChange={(e) => {
                            e.stopPropagation();
                            setSelected((prev) =>
                              e.target.checked
                                ? [...prev, f.path]
                                : prev.filter((p) => p !== f.path),
                            );
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}
                      <span className={badge.className}>{badge.label}</span>
                      <span className={filePathTextClass(isActive)}>{f.path}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {detail.applied && detail.canRevert && (
              <div className="border-t border-slate-200 dark:border-neutral-800/60 p-2">
                <button
                  type="button"
                  className="w-full text-xs text-red-400 hover:text-red-300"
                  disabled={revertM.isPending}
                  onClick={() => revertM.mutate()}
                >
                  {revertM.isPending ? 'Reverting…' : 'Revert changes'}
                </button>
              </div>
            )}
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-neutral-800/60 px-3 py-2">
              <span className={`truncate font-mono text-xs ${taskBody}`}>{activePath}</span>
              <div className="flex rounded-md border border-slate-300 p-0.5 text-xs dark:border-neutral-600">
                <button
                  type="button"
                  className={
                    viewMode === 'diff'
                      ? 'rounded bg-brand-600 px-2 py-0.5 text-white'
                      : `px-2 py-0.5 ${taskMuted}`
                  }
                  onClick={() => setViewMode('diff')}
                >
                  Diff
                </button>
                <button
                  type="button"
                  className={
                    viewMode === 'file'
                      ? 'rounded bg-brand-600 px-2 py-0.5 text-white'
                      : `px-2 py-0.5 ${taskMuted}`
                  }
                  onClick={() => setViewMode('file')}
                >
                  File
                </button>
              </div>
            </div>
            <div className={`flex-1 overflow-auto ${taskCodeSurface} p-3`}>
              {selectedDiff?.error ? (
                <div className="space-y-3">
                  <p className={`text-xs ${taskWarningText}`}>{selectedDiff.error}</p>
                  {activeFile?.content ? (
                    <>
                      <p className={`text-xs ${taskMuted}`}>
                        Proposed file content (agent used modify on a new file — shown below):
                      </p>
                      <pre className={`overflow-x-auto rounded-md p-3 text-[11px] leading-relaxed ${taskBody}`}>
                        {activeFile.content}
                      </pre>
                    </>
                  ) : activeFile?.action === 'create' && activeFile.content ? (
                    <pre className={`overflow-x-auto rounded-md p-3 text-[11px] leading-relaxed ${taskBody}`}>
                      {activeFile.content}
                    </pre>
                  ) : null}
                </div>
              ) : viewMode === 'file' && activeFile?.content ? (
                <pre className={`overflow-x-auto rounded-md p-3 text-[11px] leading-relaxed ${taskBody}`}>
                  {activeFile.content}
                </pre>
              ) : selectedDiff ? (
                <DiffView diff={selectedDiff} />
              ) : (
                <p className={`text-xs ${taskMuted}`}>Select a file to view changes</p>
              )}
            </div>
          </div>
        </div>
      )}

      {!detail.applied && output && (
        <div className={`${taskSurface} p-4`}>
          <label className={`mb-2 block text-sm font-medium ${taskTitle}`}>
            Request changes
          </label>
          <p className={`mb-2 text-xs ${taskMuted}`}>
            Describe what to change — the agent will update the proposal.
            {hasBlockingIssues && ' Quality issues listed above are sent automatically with your request.'}
          </p>
          {hasBlockingIssues && !refineText.trim() && (
            <button
              type="button"
              className={`mb-2 text-xs ${taskAccent} ${taskAccentHover}`}
              onClick={() =>
                setRefineText(
                  'Replace all stub/placeholder code with full implementations. ' +
                    'New PHPUnit test files must use action=create with full file content. ' +
                    'Keep every file from the current proposal — do not drop implementation files.\n\n' +
                    'Issues to fix:\n' +
                    [...validationErrors, ...diffErrors].map((e) => `- ${e}`).join('\n'),
                )
              }
            >
              Insert suggested fix request
            </button>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
            <textarea
              className={`${taskInput} min-h-[72px] flex-1 resize-y`}
              placeholder="e.g. Copy the first section content and make the second section green…"
              value={refineText}
              onChange={(e) => setRefineText(e.target.value)}
            />
            <button
              type="button"
              className={`${taskBtnSecondary} shrink-0`}
              disabled={refineM.isPending || !refineText.trim()}
              onClick={() => refineM.mutate()}
            >
              {refineM.isPending ? 'Updating…' : 'Update changes'}
            </button>
          </div>
        </div>
      )}

      {hasChecklist && (
        <div className={taskSurface}>
          <button
            type="button"
            onClick={() => setMetaOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left"
          >
            <span className={`text-sm font-medium ${taskTitle}`}>Checklist &amp; risks</span>
            {metaOpen ? (
              <ChevronDown className={`h-4 w-4 ${taskMuted}`} />
            ) : (
              <ChevronRight className={`h-4 w-4 ${taskMuted}`} />
            )}
          </button>
          {metaOpen && (
            <div className="grid gap-4 border-t border-slate-200 dark:border-neutral-800/60 p-4 md:grid-cols-2">
              {manualTestChecklist.length > 0 && (
                <div>
                  <h4 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${taskMuted}`}>
                    Manual checklist
                  </h4>
                  <ul className={`space-y-1.5 text-xs ${taskBody}`}>
                    {manualTestChecklist.map((c, i) => (
                      <li key={i}>☐ {c}</li>
                    ))}
                  </ul>
                </div>
              )}
              {risks.length > 0 && (
                <div>
                  <h4 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${taskMuted}`}>
                    Risks
                  </h4>
                  <ul className="space-y-1.5">
                    {risks.map((r, i) => (
                      <li key={i} className={taskRiskItem}>
                        <span aria-hidden="true">⚠ </span>
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {actionError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {actionError.message}
        </div>
      )}

      <div className={taskStickyFooter}>
        {prev ? (
          <button type="button" className={taskBtnGhost} onClick={() => onNavigate(prev)}>
            ← Back
          </button>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-2">
          {run.status === 'awaiting_review' && (
            <span className="rounded-full bg-brand-600/20 px-2.5 py-1 text-xs font-medium text-brand-300">
              Awaiting review
            </span>
          )}
          {canApprove && (
            <button
              type="button"
              className={taskBtnPrimary}
              disabled={approveM.isPending || !detail.applied}
              title={!detail.applied ? 'Apply changes before approving' : undefined}
              onClick={() => approveM.mutate()}
            >
              {approveM.isPending ? 'Approving…' : 'Approve code →'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
