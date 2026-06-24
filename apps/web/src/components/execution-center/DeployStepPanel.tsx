import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { RunDetail, TaskWorkflowStep } from '@cpwork/shared';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { api, getApiErrorMessage } from '../../lib/api';
import { previousStep } from '../task-workflow/constants';
import {
  taskBody,
  taskBtnGhost,
  taskBtnPrimary,
  taskInput,
  taskMuted,
  taskPanel,
  taskPanelHeader,
  taskTitle,
} from './taskStyles';

interface DeployStepPanelProps {
  detail: RunDetail;
  onChange: (d: RunDetail) => void;
  onNavigate: (step: TaskWorkflowStep) => void;
}

export function DeployStepPanel({ detail, onChange, onNavigate }: DeployStepPanelProps) {
  const { run } = detail;
  const wf = detail.workflow!;
  const step = wf.currentStep;

  const [jiraCommentDraft, setJiraCommentDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const draftInitialized = useRef(false);

  const jiraPreviewQ = useQuery({
    queryKey: ['jira-comment-preview', run.id],
    queryFn: async () =>
      (await api.get<{ comment: string }>(`/workflow/runs/${run.id}/jira-comment-preview`)).data,
    enabled: step === 'jira_comment' && !wf.jiraCommentPostedAt && !!run.jiraKey,
  });

  useEffect(() => {
    draftInitialized.current = false;
    setJiraCommentDraft('');
  }, [run.id]);

  useEffect(() => {
    if (jiraPreviewQ.data?.comment && !draftInitialized.current && !wf.jiraCommentPostedAt) {
      setJiraCommentDraft(jiraPreviewQ.data.comment);
      draftInitialized.current = true;
    }
  }, [jiraPreviewQ.data?.comment, wf.jiraCommentPostedAt]);

  const postJiraM = useMutation({
    mutationFn: async (comment: string) =>
      (
        await api.post<{ detail: RunDetail }>(`/workflow/runs/${run.id}/post-jira-comment`, {
          comment,
        })
      ).data.detail,
    onMutate: () => setError(null),
    onSuccess: (d) => {
      onChange(d);
      onNavigate('done');
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const prev = previousStep(step);
  const isDone = step === 'done' || !!wf.jiraCommentPostedAt;

  if (step === 'done' || (wf.jiraCommentPostedAt && step !== 'jira_comment')) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-6">
          <div className="flex items-center gap-2 text-emerald-300">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-semibold">Task complete</span>
          </div>
          <div className={`mt-3 space-y-1 text-sm ${taskBody}`}>
            {run.jiraKey && (
              <p>
                Jira: <span className="font-mono text-brand-400">{run.jiraKey}</span>
              </p>
            )}
            {run.branchName && (
              <p>
                Branch: <span className="font-mono text-slate-300">{run.branchName}</span>
              </p>
            )}
            {detail.git?.prUrl && (
              <a
                href={detail.git.prUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-brand-400 hover:underline"
              >
                View pull request ↗
              </a>
            )}
            {wf.testPassRate && <p>Tests: {wf.testPassRate}</p>}
          </div>
          {wf.jiraCommentText && (
            <div className="mt-4">
              <p className={`mb-1 text-xs font-medium uppercase tracking-wide ${taskMuted}`}>
                Jira comment posted
              </p>
              <div
                className={`max-h-48 overflow-y-auto rounded-lg border border-slate-700/60 bg-[#0f0f1a] p-3 text-sm ${taskBody} whitespace-pre-wrap`}
              >
                {wf.jiraCommentText}
              </div>
            </div>
          )}
        </div>
        {prev && (
          <button type="button" className={taskBtnGhost} onClick={() => onNavigate(prev)}>
            ← Back
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={taskPanel}>
        <header className={taskPanelHeader}>
          <h3 className={taskTitle}>Post Jira comment</h3>
        </header>
        <div className="space-y-4 p-4">
          <p className={`text-sm ${taskMuted}`}>
            Review and edit the comment, then post it to{' '}
            <span className="font-mono text-brand-400">{run.jiraKey ?? 'Jira'}</span>.
          </p>

          {wf.jiraCommentPostedAt ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
              Comment posted successfully.
              {wf.jiraCommentText && (
                <pre className={`mt-2 whitespace-pre-wrap text-xs ${taskBody}`}>
                  {wf.jiraCommentText}
                </pre>
              )}
            </div>
          ) : jiraPreviewQ.isLoading ? (
            <div className={`flex items-center gap-2 text-sm ${taskMuted}`}>
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading comment preview…
            </div>
          ) : !run.jiraKey ? (
            <p className="text-sm text-amber-300/90">No Jira ticket linked to this task.</p>
          ) : (
            <textarea
              className={`${taskInput} min-h-[200px] font-mono text-xs`}
              value={jiraCommentDraft}
              onChange={(e) => setJiraCommentDraft(e.target.value)}
              placeholder="Jira comment preview will appear here…"
            />
          )}

          {error && (
            <p className="text-sm text-red-400">{error}</p>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 border-t border-slate-700/60 bg-[#12121f]/95 px-1 py-3 backdrop-blur-sm">
        {prev ? (
          <button type="button" className={taskBtnGhost} onClick={() => onNavigate(prev)}>
            ← Back
          </button>
        ) : (
          <span />
        )}
        {!wf.jiraCommentPostedAt && run.jiraKey && (
          <button
            type="button"
            className={taskBtnPrimary}
            disabled={!jiraCommentDraft.trim() || postJiraM.isPending || jiraPreviewQ.isLoading}
            onClick={() => postJiraM.mutate(jiraCommentDraft.trim())}
          >
            {postJiraM.isPending ? 'Posting…' : 'Post to Jira & finish'}
          </button>
        )}
        {isDone && (
          <span className="text-sm text-emerald-400">Done</span>
        )}
      </div>
    </div>
  );
}
