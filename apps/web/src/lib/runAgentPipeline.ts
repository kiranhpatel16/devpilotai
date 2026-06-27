import type { RunDetail } from '@cpwork/shared';
import { api } from './api';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAgentRunComplete(detail: RunDetail): boolean {
  const gen = detail.workflow?.agentGeneration;
  if (gen?.status === 'complete') return true;
  if (gen?.status === 'failed') return true;
  if (detail.workflow?.currentStep === 'code_review') return true;
  if (detail.run.status === 'awaiting_review') return true;
  if (detail.run.status === 'failed' && gen?.status !== 'running') return true;
  return false;
}

function isAgentRunFailed(detail: RunDetail): boolean {
  const gen = detail.workflow?.agentGeneration;
  if (gen?.status === 'failed') return true;
  if (detail.run.status === 'failed' && gen?.status !== 'running') return true;
  return false;
}

function agentFailureMessage(detail: RunDetail): string {
  return detail.error || detail.run.summary || 'Code generation failed';
}

/** Start code generation (returns immediately) and poll until complete. */
export async function runAgentAndPoll(runId: string): Promise<RunDetail> {
  const started = (
    await api.post<{ detail: RunDetail; started?: boolean }>(`/workflow/runs/${runId}/run-agent`)
  ).data.detail;

  let latest = started;
  if (isAgentRunComplete(latest)) {
    if (isAgentRunFailed(latest)) {
      throw new Error(agentFailureMessage(latest));
    }
    return latest;
  }

  while (true) {
    await sleep(2000);
    latest = (await api.get<{ detail: RunDetail }>(`/workflow/runs/${runId}`)).data.detail;
    if (!isAgentRunComplete(latest)) continue;
    if (isAgentRunFailed(latest)) {
      throw new Error(agentFailureMessage(latest));
    }
    return latest;
  }
}
