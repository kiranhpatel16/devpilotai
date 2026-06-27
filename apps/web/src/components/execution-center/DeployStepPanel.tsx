import type { RunDetail, TaskWorkflowStep } from '@cpwork/shared';
import { CheckCircle2 } from 'lucide-react';
import { previousStep } from '../task-workflow/constants';
import {
  taskAccent,
  taskBody,
  taskBtnGhost,
  taskMuted,
  taskStrong,
  taskSurface,
} from './taskStyles';

interface DeployStepPanelProps {
  detail: RunDetail;
  onNavigate: (step: TaskWorkflowStep) => void;
}

export function DeployStepPanel({ detail, onNavigate }: DeployStepPanelProps) {
  const { run } = detail;
  const wf = detail.workflow!;
  const prev = previousStep(wf.currentStep);

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
              Jira: <span className={`font-mono ${taskAccent}`}>{run.jiraKey}</span>
            </p>
          )}
          {run.branchName && (
            <p>
              Branch: <span className={`font-mono ${taskStrong}`}>{run.branchName}</span>
            </p>
          )}
          {detail.git?.prUrl && (
            <a
              href={detail.git.prUrl}
              target="_blank"
              rel="noreferrer"
              className={`inline-block ${taskAccent} hover:underline`}
            >
              View pull request ↗
            </a>
          )}
          {wf.testPassRate && <p>QA: {wf.testPassRate} checks passed</p>}
        </div>
        {wf.jiraCommentText && (
          <div className="mt-4">
            <p className={`mb-1 text-xs font-medium uppercase tracking-wide ${taskMuted}`}>
              Jira comment posted
            </p>
            <div
              className={`max-h-48 overflow-y-auto ${taskSurface} p-3 text-sm ${taskBody} whitespace-pre-wrap`}
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
