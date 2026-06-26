import type { Activity, RunDetail, TestReport } from '@cpwork/shared';
import { AGENT_DEFINITIONS } from '../components/layout/navConfig';
import { isAgentStepAwaitingRun } from './workflowAdvance';

const STEP_AGENT: Record<string, string> = {
  select: 'planner',
  describe: 'planner',
  plan: 'planner',
  review_plan: 'planner',
  branch: 'developer',
  agent: 'developer',
  code_review: 'reviewer',
  deploy: 'deployment',
  commit: 'deployment',
  jira_comment: 'deployment',
  done: 'deployment',
};

const STEP_MESSAGE: Record<string, string> = {
  select: 'Selecting task…',
  branch: 'Configuring git branch and AI provider…',
  describe: 'Gathering requirements…',
  plan: 'Building implementation plan…',
  review_plan: 'Awaiting plan approval…',
  agent: 'Generating code changes…',
  code_review: 'Reviewing changes…',
  deploy: 'Running tests and local deploy…',
  commit: 'Preparing commit and pull request…',
  jira_comment: 'Posting Jira update…',
  done: 'Finishing workflow…',
};

const STEP_BUSY_DETAIL: Record<string, string> = {
  branch: 'Setting branch name, AI model, and requirement notes before plan generation.',
  describe: 'Saving task description and custom requirements.',
  plan: 'The Planner Agent is analyzing your task, repo context, and attachments to write a step-by-step plan.',
  agent: 'Creating the git branch, then the Developer Agent writes and validates file changes from the approved plan.',
  code_review: 'Preparing diffs for your review.',
  deploy: 'Running PHPUnit, static checks, and Magento setup on your local environment.',
  commit: 'Staging changes and opening a pull request.',
  jira_comment: 'Adding a workflow summary comment to the Jira issue.',
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
  const step = detail?.workflow?.currentStep;
  if (!step) return null;

  const runStatus = detail?.run.status;
  let agentId = STEP_AGENT[step] ?? 'planner';
  let message = STEP_MESSAGE[step] ?? `Processing ${step.replace(/_/g, ' ')}…`;
  let detailText = STEP_BUSY_DETAIL[step];

  if (runStatus === 'awaiting_review' || step === 'code_review') {
    agentId = 'reviewer';
    message = 'Awaiting your review';
    detailText = 'Review the proposed file changes and approve or request refinements.';
  }

  if (isAgentStepAwaitingRun(detail)) {
    message = 'Ready — click Run agent to start';
    detailText = 'Plan is approved. Start the Developer Agent when you are ready to generate code.';
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

export function getDeployBusyDetail(deploy: TestReport | null | undefined): string | undefined {
  if (!deploy?.running) return undefined;
  const steps = deploy.steps ?? [];
  const running = deploy.runningStep
    ? steps.find((s) => s.key === deploy.runningStep)
    : steps.find((s) => !s.ok && !s.skipped);
  if (running?.label) return `Deploy step: ${running.label}`;
  return 'Magento local deploy — composer, setup:upgrade, cache, and related commands.';
}

/** True when the UI should poll the server for workflow progress (not idle setup). */
export function shouldPollWorkflow(detail: RunDetail | null | undefined): boolean {
  const wf = detail?.workflow;
  if (!detail || !wf) return false;
  if (detail.run.status === 'paused' || detail.run.status === 'cancelled') return false;
  if (isAgentStepAwaitingRun(detail)) return false;
  return (
    wf.currentStep === 'agent' ||
    wf.currentStep === 'deploy' ||
    detail.run.status === 'deploying' ||
    !!detail.deploy?.running
  );
}
