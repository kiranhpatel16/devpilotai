import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { migrateStep } from '../task-workflow/constants';
import type { RunDetail, TaskWorkflowStep } from '@cpwork/shared';
import { ArrowRight } from 'lucide-react';
import { api, getApiErrorCode, getApiErrorMessage } from '../../lib/api';
import { useWorkflowBusy } from '../../context/WorkflowBusyContext';
import { previousStep } from '../task-workflow/constants';
import { FilesChangedPanel } from './FilesChangedPanel';
import { RecentCommitsTable } from './RecentCommitsTable';
import {
  taskAccent,
  taskBtnGhost,
  taskBtnPrimary,
  taskBtnSecondary,
  taskInput,
  taskMuted,
  taskPanel,
  taskPanelHeader,
  taskStickyFooter,
  taskStrong,
  taskTitle,
} from './taskStyles';
import type { WorkflowTab } from './WorkflowTabs';

interface PrStepPanelProps {
  detail: RunDetail;
  onChange: (d: RunDetail) => void;
  onNavigate: (step: TaskWorkflowStep) => void;
  onWorkflowTabChange: (tab: WorkflowTab) => void;
}

export function PrStepPanel({
  detail,
  onChange,
  onNavigate,
  onWorkflowTabChange,
}: PrStepPanelProps) {
  const { run, output, git } = detail;
  const wf = detail.workflow!;

  const [commitMessage, setCommitMessage] = useState('');
  const [actionError, setActionError] = useState<{ message: string; code?: string } | null>(null);

  useEffect(() => {
    if (run.jiraKey && output?.summary) {
      setCommitMessage(`${run.jiraKey}: ${output.summary}`);
    } else if (output?.summary) {
      setCommitMessage(output.summary);
    } else if (git?.commitMessage) {
      setCommitMessage(git.commitMessage);
    }
  }, [run.id, run.jiraKey, output?.summary, git?.commitMessage]);

  const commitM = useMutation({
    mutationFn: async () =>
      (await api.post<{ detail: RunDetail }>(`/runs/${run.id}/commit`, { message: commitMessage }))
        .data.detail,
    onMutate: () => setActionError(null),
    onSuccess: onChange,
    onError: (err) =>
      setActionError({ message: getApiErrorMessage(err), code: getApiErrorCode(err) }),
  });

  const pushM = useMutation({
    mutationFn: async () =>
      (await api.post<{ detail: RunDetail }>(`/runs/${run.id}/push`)).data.detail,
    onMutate: () => setActionError(null),
    onSuccess: onChange,
    onError: (err) =>
      setActionError({ message: getApiErrorMessage(err), code: getApiErrorCode(err) }),
  });

  const prM = useMutation({
    mutationFn: async () =>
      (await api.post<{ detail: RunDetail }>(`/runs/${run.id}/pr`)).data.detail,
    onMutate: () => setActionError(null),
    onSuccess: onChange,
    onError: (err) =>
      setActionError({ message: getApiErrorMessage(err), code: getApiErrorCode(err) }),
  });

  const step = migrateStep(wf.currentStep);
  const prev = previousStep(step);
  const canContinue = !!(git?.prUrl || git?.pushed);

  const advanceQaM = useMutation({
    mutationFn: async () =>
      (await api.post<{ detail: RunDetail }>(`/workflow/runs/${run.id}/advance-to-qa`)).data.detail,
    onSuccess: (d) => {
      onChange(d);
      onWorkflowTabChange('qa');
    },
    onError: (err) =>
      setActionError({ message: getApiErrorMessage(err), code: getApiErrorCode(err) }),
  });

  useWorkflowBusy('git-commit', commitM.isPending, 'Committing changes…', 'Creating a git commit on your task branch.');
  useWorkflowBusy('git-push', pushM.isPending, 'Pushing to remote…', 'Uploading commits to the remote repository.');
  useWorkflowBusy('create-pr', prM.isPending, 'Creating pull request…', 'Opening a staging PR for review.');
  useWorkflowBusy('advance-to-qa', advanceQaM.isPending, 'Continuing to QA…', 'Moving to automated test execution.');

  return (
    <div className="space-y-4">
      <div className={taskPanel}>
        <header className={taskPanelHeader}>
          <h3 className={taskTitle}>Commit &amp; pull request</h3>
        </header>
        <div className="space-y-4 p-4">
          <div>
            <label className={`mb-1.5 block text-xs font-medium ${taskMuted}`}>
              Commit message
            </label>
            <textarea
              className={`${taskInput} min-h-[80px] font-mono text-xs`}
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="Describe your changes…"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={taskBtnSecondary}
              disabled={commitM.isPending || !commitMessage.trim() || git?.committed || !detail.applied}
              onClick={() => commitM.mutate()}
            >
              {git?.committed ? 'Committed ✓' : commitM.isPending ? 'Committing…' : 'Commit'}
            </button>
            <button
              type="button"
              className={taskBtnSecondary}
              disabled={pushM.isPending || !git?.committed || git?.pushed}
              onClick={() => pushM.mutate()}
            >
              {git?.pushed ? 'Pushed ✓' : pushM.isPending ? 'Pushing…' : 'Push'}
            </button>
            <button
              type="button"
              className={git?.prUrl ? taskBtnSecondary : taskBtnPrimary}
              disabled={prM.isPending || !git?.pushed || !!git?.prUrl}
              onClick={() => prM.mutate()}
            >
              {git?.prUrl
                ? 'PR created ✓'
                : prM.isPending
                  ? 'Opening PR…'
                  : 'Create staging PR'}
            </button>
          </div>
          {git?.prUrl && (
            <a
              href={git.prUrl}
              target="_blank"
              rel="noreferrer"
              className={`inline-block text-sm font-medium ${taskAccent} hover:underline`}
            >
              View pull request ↗
            </a>
          )}
          {!detail.applied && (
            <p className="text-xs text-amber-300/90">Changes must be applied before committing.</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <FilesChangedPanel detail={detail} compact title="Files in this PR" />
        <RecentCommitsTable runId={run.id} branchName={run.branchName} />
      </div>

      {actionError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          <p>{actionError.message}</p>
          {['gh_missing', 'pr_not_configured', 'pr_token_missing', 'pr_username_missing'].includes(
            actionError.code ?? '',
          ) && (
            <p className={`mt-1 text-xs ${taskMuted}`}>
              Configure Git/PR credentials in project settings, or open a PR manually for branch{' '}
              <code className={taskStrong}>{run.branchName}</code>.
            </p>
          )}
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
        <button
          type="button"
          className={taskBtnPrimary}
          disabled={!canContinue || advanceQaM.isPending}
          onClick={() => advanceQaM.mutate()}
        >
          {advanceQaM.isPending ? 'Continuing…' : 'Continue to QA'}
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
