import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { RunDetail, TaskWorkflowStep } from '@cpwork/shared';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { api, getApiErrorMessage, longRequest } from '../../lib/api';
import { DiffView } from '../DiffView';
import { previousStep } from '../task-workflow/constants';
import {
  taskBody,
  taskBtnGhost,
  taskBtnPrimary,
  taskBtnSecondary,
  taskInput,
  taskMuted,
  taskPanel,
  taskTitle,
} from './taskStyles';

interface ReviewStepPanelProps {
  detail: RunDetail;
  userNotes?: string | null;
  onChange: (d: RunDetail) => void;
  onNavigate: (step: TaskWorkflowStep) => void;
  onWorkflowTabChange?: (tab: 'tests') => void;
}

function statusBadge(action: string) {
  const a = action.toLowerCase();
  if (a === 'create') return { label: 'A', className: 'bg-emerald-500/20 text-emerald-400' };
  if (a === 'delete') return { label: 'D', className: 'bg-red-500/20 text-red-400' };
  return { label: 'M', className: 'bg-brand-600/20 text-brand-300' };
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

  const diffs = detail.diffs;
  const files = output?.files ?? [];
  const activePath = selectedPath ?? files[0]?.path ?? diffs[0]?.path ?? null;
  const selectedDiff = diffs.find((d) => d.path === activePath) ?? diffs[0];

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

  const prev = previousStep(step);
  const hasChecklist =
    (output?.manualTestChecklist.length ?? 0) > 0 || (output?.risks.length ?? 0) > 0;

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
        <p className={`rounded-lg border border-slate-700/60 bg-[#0f0f1a] px-4 py-3 text-sm ${taskBody}`}>
          {output.summary}
        </p>
      )}

      {userNotes?.trim() && (
        <p className={`text-xs ${taskMuted}`}>
          <span className="text-slate-500">Your notes:</span>{' '}
          <span className="text-slate-300">{userNotes.trim()}</span>
        </p>
      )}

      {detail.error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {detail.error}
        </div>
      )}

      {diffs.length === 0 ? (
        <p className={`text-sm ${taskMuted}`}>The AI proposed no file changes.</p>
      ) : (
        <div
          className={`${taskPanel} grid min-h-[60vh] overflow-hidden lg:grid-cols-[240px_1fr]`}
        >
          <div className="flex flex-col border-b border-slate-700/60 lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between border-b border-slate-700/60 px-3 py-2.5">
              <h3 className={taskTitle}>Files ({files.length})</h3>
              {!detail.applied && (
                <button
                  type="button"
                  className={`${taskBtnPrimary} px-2 py-1 text-xs`}
                  disabled={applyM.isPending || selected.length === 0}
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
                const badge = statusBadge(f.action ?? 'modify');
                const diff = diffs.find((d) => d.path === f.path);
                return (
                  <li key={f.path}>
                    <button
                      type="button"
                      onClick={() => setSelectedPath(f.path)}
                      className={[
                        'flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left',
                        activePath === f.path
                          ? 'bg-brand-600/20 text-brand-300'
                          : 'text-slate-400 hover:bg-slate-800',
                      ].join(' ')}
                    >
                      {!detail.applied && (
                        <input
                          type="checkbox"
                          className="mt-0.5"
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
                      <span className={`shrink-0 rounded px-1 text-[10px] font-bold ${badge.className}`}>
                        {badge.label}
                      </span>
                      <span className="min-w-0 flex-1 break-all font-mono text-[11px] leading-snug">
                        {f.path}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {detail.applied && detail.canRevert && (
              <div className="border-t border-slate-700/60 p-2">
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
            <div className="flex items-center justify-between border-b border-slate-700/60 px-3 py-2">
              <span className="truncate font-mono text-xs text-slate-400">{activePath}</span>
              <div className="flex rounded-md border border-slate-600 p-0.5 text-xs">
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
            <div className="flex-1 overflow-auto bg-[#0a0a12] p-3">
              {selectedDiff?.error ? (
                <p className="text-xs text-red-400">{selectedDiff.error}</p>
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
        <div className="rounded-lg border border-slate-700/60 bg-[#0f0f1a] p-4">
          <label className={`mb-2 block text-sm font-medium text-white`}>
            Request changes
          </label>
          <p className={`mb-2 text-xs ${taskMuted}`}>
            Describe what to change — the agent will update the proposal.
          </p>
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
        <div className="rounded-lg border border-slate-700/60 bg-[#0f0f1a]">
          <button
            type="button"
            onClick={() => setMetaOpen((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left"
          >
            <span className="text-sm font-medium text-white">Checklist &amp; risks</span>
            {metaOpen ? (
              <ChevronDown className={`h-4 w-4 ${taskMuted}`} />
            ) : (
              <ChevronRight className={`h-4 w-4 ${taskMuted}`} />
            )}
          </button>
          {metaOpen && (
            <div className="grid gap-4 border-t border-slate-700/60 p-4 md:grid-cols-2">
              {output.manualTestChecklist.length > 0 && (
                <div>
                  <h4 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${taskMuted}`}>
                    Manual checklist
                  </h4>
                  <ul className="space-y-1.5 text-xs text-slate-300">
                    {output.manualTestChecklist.map((c, i) => (
                      <li key={i}>☐ {c}</li>
                    ))}
                  </ul>
                </div>
              )}
              {output.risks.length > 0 && (
                <div>
                  <h4 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${taskMuted}`}>
                    Risks
                  </h4>
                  <ul className="space-y-1.5 text-xs text-amber-300/90">
                    {output.risks.map((r, i) => (
                      <li key={i}>⚠ {r}</li>
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

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 border-t border-slate-700/60 bg-[#12121f]/95 px-1 py-3 backdrop-blur-sm">
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
