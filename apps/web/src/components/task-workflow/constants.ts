import type { TaskWorkflowStep } from '@cpwork/shared';

/** Canonical workflow steps (legacy ids are migrated server-side). */
export const WORKFLOW_STEPS: { id: TaskWorkflowStep; label: string }[] = [
  { id: 'select', label: 'Select' },
  { id: 'requirement_analysis', label: 'Analysis' },
  { id: 'environment_setup', label: 'Setup' },
  { id: 'architecture_design', label: 'Architecture' },
  { id: 'development_plan', label: 'Plan' },
  { id: 'test_cases', label: 'Test Cases' },
  { id: 'pre_dev_approval', label: 'Approval' },
  { id: 'agent', label: 'Code' },
  { id: 'code_review', label: 'Review' },
  { id: 'deploy', label: 'Build' },
  { id: 'commit', label: 'Git' },
  { id: 'qa', label: 'QA' },
  { id: 'jira_comment', label: 'Jira' },
  { id: 'done', label: 'Done' },
];

const LEGACY_STEP_MAP: Partial<Record<TaskWorkflowStep, TaskWorkflowStep>> = {
  branch: 'environment_setup',
  describe: 'requirement_analysis',
  plan: 'development_plan',
  review_plan: 'pre_dev_approval',
};

export function migrateStep(step: TaskWorkflowStep): TaskWorkflowStep {
  return LEGACY_STEP_MAP[step] ?? step;
}

export function stepIndex(step: TaskWorkflowStep): number {
  const migrated = migrateStep(step);
  const idx = WORKFLOW_STEPS.findIndex((s) => s.id === migrated);
  return idx >= 0 ? idx : -1;
}

export function canGoToStep(
  completed: TaskWorkflowStep[],
  current: TaskWorkflowStep,
  target: TaskWorkflowStep,
): boolean {
  const targetM = migrateStep(target);
  const currentM = migrateStep(current);
  if (targetM === currentM) return true;
  const targetIdx = stepIndex(targetM);
  const currentIdx = stepIndex(currentM);
  if (targetIdx < 0 || currentIdx < 0) return false;
  if (targetIdx <= currentIdx) return true;
  return completed.map(migrateStep).includes(targetM);
}

export function previousStep(step: TaskWorkflowStep): TaskWorkflowStep | null {
  const idx = stepIndex(step);
  if (idx <= 0) return null;
  return WORKFLOW_STEPS[idx - 1]!.id;
}
