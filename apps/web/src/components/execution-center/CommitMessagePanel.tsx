import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { RunDetail } from '@cpwork/shared';
import { api, getApiErrorMessage } from '../../lib/api';
import {
  taskBtnPrimary,
  taskInput,
  taskPanel,
  taskPanelHeader,
  taskTitle,
} from './taskStyles';

interface CommitMessagePanelProps {
  detail: RunDetail;
  onChange: (detail: RunDetail) => void;
}

export function CommitMessagePanel({ detail, onChange }: CommitMessagePanelProps) {
  const { run, output, git } = detail;
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (run.jiraKey && output?.summary) {
      setMessage(`${run.jiraKey}: ${output.summary}`);
    } else if (output?.summary) {
      setMessage(output.summary);
    } else if (git?.commitMessage) {
      setMessage(git.commitMessage);
    }
  }, [run.id, run.jiraKey, output?.summary, git?.commitMessage]);

  const commitM = useMutation({
    mutationFn: async () =>
      (
        await api.post<{ detail: RunDetail }>(`/runs/${run.id}/commit`, { message })
      ).data.detail,
    onMutate: () => setError(null),
    onSuccess: onChange,
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const canCommit = detail.applied && !git?.committed && !!message.trim();
  const wf = detail.workflow;
  const showPanel =
    wf &&
    ['agent', 'code_review', 'deploy', 'commit'].includes(wf.currentStep) &&
    detail.applied;

  if (!showPanel) return null;

  return (
    <div className={taskPanel}>
      <header className={taskPanelHeader}>
        <h3 className={taskTitle}>Commit Message</h3>
      </header>
      <div className="space-y-3 p-4">
        <textarea
          className={`${taskInput} min-h-[80px] font-mono text-xs`}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Describe your changes…"
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          type="button"
          className={`${taskBtnPrimary} w-full sm:w-auto`}
          disabled={!canCommit || commitM.isPending || git?.committed}
          onClick={() => commitM.mutate()}
        >
          {git?.committed
            ? 'Committed ✓'
            : commitM.isPending
              ? 'Committing…'
              : 'Commit & Continue'}
        </button>
      </div>
    </div>
  );
}
