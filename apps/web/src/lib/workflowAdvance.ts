import type { RunDetail, TaskWorkflowStep } from '@cpwork/shared';
import { api, longRequest } from './api';

const EARLY_STEPS: TaskWorkflowStep[] = ['select', 'branch', 'describe'];

export function isEarlyWorkflowStep(step: TaskWorkflowStep | null | undefined): boolean {
  return !!step && EARLY_STEPS.includes(step);
}

/** Plan approved on the Code step — user must click Run agent before work starts. */
export function isAgentStepAwaitingRun(detail: RunDetail | null | undefined): boolean {
  const wf = detail?.workflow;
  if (!wf || wf.currentStep !== 'agent') return false;
  // Plan generation stores its AI response in `output`; rely on approval status instead.
  return wf.approvalStatus === 'plan_approved';
}

interface AdvanceSetupInput {
  branchName: string;
  provider: string | null;
  model: string | null;
  userInstructions: string | null;
}

async function patchStep(
  runId: string,
  step: TaskWorkflowStep,
  setup: AdvanceSetupInput,
): Promise<RunDetail> {
  return (
    await api.patch<{ detail: RunDetail }>(`/workflow/runs/${runId}/step`, {
      step,
      branchName: setup.branchName,
      provider: setup.provider,
      model: setup.model,
      userInstructions: setup.userInstructions,
    })
  ).data.detail;
}

/** Advance through select → branch → describe → plan, then generate plan if needed. */
export async function advanceToPlanAndGenerate(
  detail: RunDetail,
  setup: AdvanceSetupInput,
): Promise<RunDetail> {
  let current = detail;
  const runId = current.run.id;

  while (isEarlyWorkflowStep(current.workflow?.currentStep)) {
    const step = current.workflow!.currentStep;
    if (step === 'select') {
      current = await patchStep(runId, 'branch', setup);
    } else if (step === 'branch') {
      current = await patchStep(runId, 'describe', setup);
    } else if (step === 'describe') {
      current = await patchStep(runId, 'plan', setup);
    } else {
      break;
    }
  }

  if (current.workflow?.currentStep === 'plan' && !current.workflow.planMarkdown) {
    current = (
      await api.post<{ detail: RunDetail }>(`/workflow/runs/${runId}/generate-plan`, undefined, longRequest)
    ).data.detail;
  }

  return current;
}
