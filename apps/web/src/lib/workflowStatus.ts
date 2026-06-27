import type { Activity, RunDetail } from '@cpwork/shared';
import { AGENT_DEFINITIONS } from '../components/layout/navConfig';
import { isAgentStepAwaitingRun } from './workflowAdvance';
import { migrateStep } from '../components/task-workflow/constants';

const STEP_AGENT: Record<string, string> = {
  select: 'planner',
  requirement_analysis: 'planner',
  environment_setup: 'developer',
  architecture_design: 'planner',
  development_plan: 'planner',
  test_cases: 'planner',
  pre_dev_approval: 'planner',
  branch: 'developer',
  describe: 'planner',
  plan: 'planner',
  review_plan: 'planner',
  agent: 'developer',
  code_review: 'reviewer',
  deploy: 'deployment',
  commit: 'deployment',
  qa: 'qa',
  done: 'deployment',
  jira_comment: 'deployment',
};

const STEP_MESSAGE: Record<string, string> = {
  select: 'Selecting task…',
  requirement_analysis: 'Analyzing requirements…',
  environment_setup: 'Configuring branch and AI…',
  architecture_design: 'Designing architecture…',
  development_plan: 'Building development plan…',
  test_cases: 'Generating test cases…',
  pre_dev_approval: 'Awaiting pre-development approval…',
  branch: 'Configuring git branch and AI provider…',
  describe: 'Gathering requirements…',
  plan: 'Building implementation plan…',
  review_plan: 'Awaiting plan approval…',
  agent: 'Generating code changes…',
  code_review: 'Reviewing changes…',
  deploy: 'Running build verification…',
  commit: 'Preparing commit and pull request…',
  qa: 'Running QA automation…',
  jira_comment: 'Posting Jira update…',
  done: 'Ready for merge',
};

const STEP_BUSY_DETAIL: Record<string, string> = {
  requirement_analysis:
    'The Planner Agent reads the task, knowledge base, and codebase to produce a requirement analysis.',
  environment_setup: 'Set branch name, AI model, and development agent persona.',
  architecture_design:
    'Generating system overview, component diagram, and dependency mapping from the analysis.',
  development_plan:
    'Creating structured implementation tasks with time estimates.',
  test_cases: 'Generating functional, UI, and regression test cases before coding.',
  pre_dev_approval: 'Review all artifacts and approve before AI writes code.',
  branch: 'Setting branch name, AI model, and requirement notes.',
  plan: 'The Planner Agent writes a step-by-step plan.',
  agent: 'The Developer Agent writes and validates file changes from approved artifacts.',
  deploy: 'Running Magento setup:upgrade, compile, deploy, and cache commands.',
  code_review: 'Review AI-generated changes, apply to your workspace, then continue to build verification.',
  commit: 'Staging changes, committing, pushing, and opening a pull request.',
  qa: 'Running PHPUnit, visual smoke, and Playwright tests.',
  jira_comment: 'Post a formatted summary comment to the linked Jira issue.',
};

export interface WorkflowAgentStatus {
  agentLabel: string;
  message: string;
  detail?: string;
  lastActivity?: string;
}

export function getWorkflowAgentStatus(
  detail: RunDetail | null | undefined,
  lastActivity?: Activity | null,
): WorkflowAgentStatus | null {
  const rawStep = detail?.workflow?.currentStep;
  if (!rawStep) return null;
  const step = migrateStep(rawStep);

  const runStatus = detail?.run.status;
  let agentId = STEP_AGENT[step] ?? 'planner';
  let message = STEP_MESSAGE[step] ?? `Processing ${step.replace(/_/g, ' ')}…`;
  let detailText = STEP_BUSY_DETAIL[step];

  if (runStatus === 'awaiting_review' || step === 'code_review') {
    agentId = 'reviewer';
    message = 'Awaiting your review';
    detailText = 'Review AI findings and file diffs, then approve or request changes.';
  }

  if (isAgentStepAwaitingRun(detail)) {
    message = 'Ready — click Run agent to start';
    detailText = 'Pre-development artifacts are approved. Start the Developer Agent when ready.';
  }

  const gen = detail?.workflow?.agentGeneration;
  if (detail?.run.status === 'analyzing' || gen?.status === 'running') {
    agentId = 'developer';
    message = 'Generating code changes…';
    if (gen?.totalChunks && gen.totalChunks > 1) {
      detailText = `Part ${gen.currentChunk} of ${gen.totalChunks} — ${gen.filesGenerated} file(s) generated so far.`;
    } else {
      detailText = 'The Developer Agent is writing file changes from the approved plan.';
    }
  }

  const agent = AGENT_DEFINITIONS.find((a) => a.id === agentId);

  return {
    agentLabel: agent?.label ?? 'Agent',
    message,
    detail: detailText,
    lastActivity: lastActivity?.summary,
  };
}

export function formatWorkflowStatusLine(status: WorkflowAgentStatus): string {
  return `${status.agentLabel} · ${status.message}`;
}

export function getDeployBusyDetail(deploy: RunDetail['deploy']): string | undefined {
  if (!deploy?.running) return undefined;
  const steps = deploy.steps ?? [];
  const running = deploy.runningStep
    ? steps.find((s) => s.key === deploy.runningStep)
    : steps.find((s) => !s.ok && !s.skipped);
  if (running?.label) return `Build step: ${running.label}`;
  return 'Magento local deploy — setup:upgrade, compile, cache, and related commands.';
}

/** True while the developer agent is actively generating code (including chunked runs). */
export function isCodeGenerationActive(detail: RunDetail | null | undefined): boolean {
  if (!detail) return false;
  if (detail.run.status === 'analyzing') return true;
  return detail.workflow?.agentGeneration?.status === 'running';
}

/** Detail line for the global busy overlay during code generation. */
export function getCodeGenBusyDetail(detail: RunDetail | null | undefined): string | undefined {
  const gen = detail?.workflow?.agentGeneration;
  if (gen?.totalChunks && gen.totalChunks > 1) {
    const chunk = Math.min(gen.currentChunk || 1, gen.totalChunks);
    const files = gen.filesGenerated ?? 0;
    const fileNote = files > 0 ? ` — ${files} file(s) generated so far` : '';
    return `Part ${chunk} of ${gen.totalChunks}${fileNote}.`;
  }
  return 'The Developer Agent is writing file changes from the approved plan.';
}

/** True when the UI should poll the server for workflow progress. */
export function shouldPollWorkflow(detail: RunDetail | null | undefined): boolean {
  const wf = detail?.workflow;
  if (!detail || !wf) return false;
  if (detail.run.status === 'paused' || detail.run.status === 'cancelled') return false;
  if (isAgentStepAwaitingRun(detail)) return false;
  if (detail.run.status === 'analyzing') return true;
  if (wf.agentGeneration?.status === 'running') return true;
  const step = migrateStep(wf.currentStep);
  return (
    step === 'agent' ||
    step === 'deploy' ||
    detail.run.status === 'deploying' ||
    !!detail.deploy?.running
  );
}

export type WorkflowStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'approval';

export function getStepStatus(
  detail: RunDetail | null | undefined,
  stepId: string,
): WorkflowStepStatus {
  if (!detail?.workflow) return 'pending';
  const step = migrateStep(stepId as RunDetail['workflow'] extends null ? never : import('@cpwork/shared').TaskWorkflowStep);
  const wf = detail.workflow;
  const current = migrateStep(wf.currentStep);
  const completed = (wf.completedSteps ?? []).map(migrateStep);

  if (wf.approvalStatus === 'failed' && current === step) return 'failed';
  if (step === 'pre_dev_approval' && wf.approvalStatus === 'pre_dev_pending') return 'approval';
  if (completed.includes(step)) return 'completed';
  if (current === step) {
    if (detail.deploy?.running || (step === 'agent' && detail.run.status === 'deploying')) {
      return 'running';
    }
    if (step === 'pre_dev_approval') return 'approval';
    return 'running';
  }
  return 'pending';
}
