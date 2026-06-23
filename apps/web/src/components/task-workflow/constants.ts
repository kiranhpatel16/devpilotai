import type { TaskWorkflowStep } from '@cpwork/shared';

export const WORKFLOW_STEPS: { id: TaskWorkflowStep; label: string }[] = [
  { id: 'select', label: 'Select' },
  { id: 'branch', label: 'Branch' },
  { id: 'describe', label: 'Describe' },
  { id: 'plan', label: 'Plan' },
  { id: 'review_plan', label: 'Review' },
  { id: 'agent', label: 'Code' },
  { id: 'code_review', label: 'Review' },
  { id: 'deploy', label: 'Deploy' },
  { id: 'commit', label: 'Commit' },
  { id: 'jira_comment', label: 'Jira' },
  { id: 'done', label: 'Done' },
];

export function stepIndex(step: TaskWorkflowStep): number {
  return WORKFLOW_STEPS.findIndex((s) => s.id === step);
}

export function canGoToStep(
  completed: TaskWorkflowStep[],
  current: TaskWorkflowStep,
  target: TaskWorkflowStep,
): boolean {
  if (target === current) return true;
  const targetIdx = stepIndex(target);
  const currentIdx = stepIndex(current);
  if (targetIdx < 0 || currentIdx < 0) return false;
  if (targetIdx <= currentIdx) return true;
  return completed.includes(target);
}
