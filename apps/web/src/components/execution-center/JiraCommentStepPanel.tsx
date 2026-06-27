import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { RunDetail, TaskWorkflowStep } from '@cpwork/shared';
import { ArrowRight, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import { api, getApiErrorMessage } from '../../lib/api';
import { useWorkflowBusy } from '../../context/WorkflowBusyContext';
import { migrateStep, previousStep } from '../task-workflow/constants';
import {
  taskAccent,
  taskBody,
  taskBtnGhost,
  taskBtnPrimary,
  taskBtnSecondary,
  taskInput,
  taskMuted,
  taskPanel,
  taskPanelHeader,
  taskStickyFooter,
  taskStrong,
  taskSurface,
  taskTitle,
} from './taskStyles';
import type { WorkflowTab } from './WorkflowTabs';

interface JiraCommentStepPanelProps {
  detail: RunDetail;
  onChange: (d: RunDetail) => void;
  onNavigate: (step: TaskWorkflowStep) => void;
  onWorkflowTabChange: (tab: WorkflowTab) => void;
}

export function JiraCommentStepPanel({
  detail,
  onChange,
  onNavigate,
  onWorkflowTabChange,
}: JiraCommentStepPanelProps) {
  const { run } = detail;
  const wf = detail.workflow!;
  const step = migrateStep(wf.currentStep);

  const [jiraCommentDraft, setJiraCommentDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const draftInitialized = useRef(false);

  const jiraPreviewQ = useQuery({
    queryKey: ['jira-comment-preview', run.id],
    queryFn: async () =>
      (await api.get<{ comment: string }>(`/workflow/runs/${run.id}/jira-comment-preview`)).data,
    enabled: !wf.jiraCommentPostedAt && !!run.jiraKey,
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
      onWorkflowTabChange('done');
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const skipJiraM = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ detail: RunDetail }>(`/workflow/runs/${run.id}/skip-jira-comment`)
      ).data.detail,
    onSuccess: (d) => {
      onChange(d);
      onWorkflowTabChange('done');
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  useWorkflowBusy(
    'post-jira-comment',
    postJiraM.isPending,
    'Posting to Jira…',
    'Adding a summary comment to the linked Jira issue.',
  );
  useWorkflowBusy(
    'skip-jira-comment',
    skipJiraM.isPending,
    'Finishing workflow…',
    'Completing the task without a Jira comment.',
  );

  const prev = previousStep(step);
  const jiraKey = run.jiraKey;
  const jiraSummary = wf.jiraSnapshot?.summary;

  if (wf.jiraCommentPostedAt) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
          <div className="flex items-center gap-2 text-emerald-300">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-semibold">Jira comment posted</span>
          </div>
          {jiraKey && (
            <p className={`mt-2 text-sm ${taskBody}`}>
              Added to{' '}
              <span className={`font-mono ${taskAccent}`}>{jiraKey}</span>
              {jiraSummary ? ` — ${jiraSummary}` : ''}
            </p>
          )}
          {wf.jiraCommentText && (
            <div
              className={`mt-3 max-h-64 overflow-y-auto ${taskSurface} p-3 text-sm ${taskBody} whitespace-pre-wrap`}
            >
              {wf.jiraCommentText}
            </div>
          )}
        </div>
        <button
          type="button"
          className={taskBtnPrimary}
          onClick={() => onWorkflowTabChange('done')}
        >
          View completion summary
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className={taskPanel}>
        <header className={taskPanelHeader}>
          <h3 className={taskTitle}>Jira task comment</h3>
        </header>
        <div className="space-y-4 p-4">
          <p className={`text-sm ${taskMuted}`}>
            Post a formatted summary to the linked Jira issue with requirements, architecture, QA
            results, files changed, and PR details. Review and edit before posting.
          </p>

          {jiraKey ? (
            <div className={`${taskSurface} px-3 py-2 text-sm ${taskBody}`}>
              <span className={taskMuted}>Issue: </span>
              <span className={`font-mono ${taskStrong}`}>{jiraKey}</span>
              {jiraSummary && (
                <>
                  <span className={taskMuted}> — </span>
                  <span>{jiraSummary}</span>
                </>
              )}
            </div>
          ) : (
            <p className="text-sm text-amber-300/90">
              No Jira ticket is linked to this task. Skip to mark the workflow complete.
            </p>
          )}

          {jiraKey && (
            <>
              {jiraPreviewQ.isLoading ? (
                <div className={`flex items-center gap-2 text-sm ${taskMuted}`}>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Building comment preview…
                </div>
              ) : jiraPreviewQ.isError ? (
                <p className="text-sm text-red-300">{getApiErrorMessage(jiraPreviewQ.error)}</p>
              ) : (
                <textarea
                  className={`${taskInput} min-h-[320px] font-mono text-xs leading-relaxed`}
                  value={jiraCommentDraft}
                  onChange={(e) => setJiraCommentDraft(e.target.value)}
                  placeholder="Comment preview will appear here…"
                />
              )}

              {detail.git?.prUrl && (
                <p className={`text-xs ${taskMuted}`}>
                  PR link will be included:{' '}
                  <a
                    href={detail.git.prUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={`inline-flex items-center gap-0.5 ${taskAccent} hover:underline`}
                  >
                    {detail.git.prUrl}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </p>
              )}
            </>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      </div>

      <div className={taskStickyFooter}>
        {prev ? (
          <button type="button" className={taskBtnGhost} onClick={() => onNavigate(prev)}>
            ← Back to QA
          </button>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center gap-2">
          {!jiraKey && (
            <button
              type="button"
              className={taskBtnPrimary}
              disabled={skipJiraM.isPending}
              onClick={() => skipJiraM.mutate()}
            >
              {skipJiraM.isPending ? 'Finishing…' : 'Continue to Done'}
              <ArrowRight className="h-4 w-4" />
            </button>
          )}
          {jiraKey && (
            <>
              <button
                type="button"
                className={taskBtnSecondary}
                disabled={skipJiraM.isPending || postJiraM.isPending}
                onClick={() => skipJiraM.mutate()}
              >
                Skip Jira comment
              </button>
              <button
                type="button"
                className={taskBtnPrimary}
                disabled={
                  !jiraCommentDraft.trim() || postJiraM.isPending || jiraPreviewQ.isLoading
                }
                onClick={() => postJiraM.mutate(jiraCommentDraft.trim())}
              >
                {postJiraM.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Posting…
                  </>
                ) : (
                  <>
                    Add comment in Jira
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
