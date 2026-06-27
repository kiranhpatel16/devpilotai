import type { RunDetail, TaskWorkflowStep } from '@cpwork/shared';
import { api, longRequest } from './api';
import { migrateStep } from '../components/task-workflow/constants';
import { workflowArtifactsStale } from './workflowTaskMatch';

const PRE_DEV_STEPS: TaskWorkflowStep[] = [
  'requirement_analysis',
  'environment_setup',
  'architecture_design',
  'development_plan',
  'test_cases',
  'pre_dev_approval',
];

export function isEarlyWorkflowStep(step: TaskWorkflowStep | null | undefined): boolean {
  if (!step) return false;
  const m = migrateStep(step);
  return (
    m === 'select' ||
    m === 'requirement_analysis' ||
    m === 'environment_setup' ||
    PRE_DEV_STEPS.includes(m)
  );
}

export function isPreDevApprovalStep(step: TaskWorkflowStep | null | undefined): boolean {
  return !!step && migrateStep(step) === 'pre_dev_approval';
}

/** Plan approved on the Code step — user must click Run agent before work starts. */
export function isAgentStepAwaitingRun(detail: RunDetail | null | undefined): boolean {
  const wf = detail?.workflow;
  if (!wf || migrateStep(wf.currentStep) !== 'agent') return false;
  const status = wf.approvalStatus;
  return status === 'pre_dev_approved' || status === 'plan_approved';
}

interface AdvanceSetupInput {
  branchName: string;
  /** Planning AI — requirement analysis, architecture, plan. */
  provider: string | null;
  model: string | null;
  /** Coding AI — agent / file edits. */
  codingProvider: string | null;
  codingModel: string | null;
  userInstructions: string | null;
  devAgentId?: string | null;
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
      codingProvider: setup.codingProvider,
      codingModel: setup.codingModel,
      userInstructions: setup.userInstructions,
      devAgentId: setup.devAgentId ?? undefined,
    })
  ).data.detail;
}

/** Run full pre-development pipeline: analysis → setup → architecture → plan → test cases. */
export async function advancePreDevPipeline(
  detail: RunDetail,
  setup: AdvanceSetupInput,
): Promise<RunDetail> {
  const runId = detail.run.id;
  let current = detail;
  const staleArtifacts = workflowArtifactsStale(current);

  const step = migrateStep(current.workflow?.currentStep ?? 'select');

  if (step === 'select') {
    current = await patchStep(runId, 'requirement_analysis', setup);
  }

  if (staleArtifacts || !current.workflow?.requirementAnalysis) {
    current = (
      await api.post<{ detail: RunDetail }>(
        `/workflow/runs/${runId}/generate-analysis`,
        undefined,
        longRequest,
      )
    ).data.detail;
  }

  if (migrateStep(current.workflow?.currentStep ?? 'select') === 'environment_setup') {
    current = await patchStep(runId, 'architecture_design', setup);
  }

  if (staleArtifacts || !current.workflow?.architectureDesign) {
    current = (
      await api.post<{ detail: RunDetail }>(
        `/workflow/runs/${runId}/generate-architecture`,
        undefined,
        longRequest,
      )
    ).data.detail;
  }

  if (staleArtifacts || !current.workflow?.planMarkdown) {
    current = (
      await api.post<{ detail: RunDetail }>(`/workflow/runs/${runId}/generate-plan`, undefined, longRequest)
    ).data.detail;
  }

  if (staleArtifacts || !current.workflow?.testCases?.length) {
    current = (
      await api.post<{ detail: RunDetail }>(
        `/workflow/runs/${runId}/generate-test-cases`,
        undefined,
        longRequest,
      )
    ).data.detail;
    if (!current.workflow?.testCases?.length) {
      throw new Error('Test case generation returned no cases. Please try again.');
    }
  }

  return current;
}

/** @deprecated Use advancePreDevPipeline */
export async function advanceToPlanAndGenerate(
  detail: RunDetail,
  setup: AdvanceSetupInput,
): Promise<RunDetail> {
  return advancePreDevPipeline(detail, setup);
}
