import type { RunDetail } from '@cpwork/shared';

/** True when stored workflow artifacts belong to a different Jira ticket than the run. */
export function workflowArtifactsStale(detail: RunDetail): boolean {
  return !artifactsMatchTask(detail);
}

/** True when pre-dev artifacts were generated for this task ticket and title. */
export function artifactsMatchTask(detail: RunDetail): boolean {
  const wf = detail.workflow;
  if (!wf) return true;
  const hasArtifacts =
    !!wf.requirementAnalysis ||
    !!wf.architectureDesign ||
    !!wf.planMarkdown ||
    !!(wf.testCases?.length);
  if (!hasArtifacts) return true;

  const runKey = detail.run.jiraKey?.trim();
  const storedKey = wf.artifactsForTaskKey?.trim();
  const summary = wf.jiraSnapshot?.summary?.trim();
  const storedSummary = wf.artifactsForTaskSummary?.trim();

  if (runKey && storedKey && runKey !== storedKey) return false;
  if (summary && storedSummary && summary !== storedSummary) return false;
  if (summary && !storedSummary) return false;
  if (runKey && wf.jiraSnapshot?.key && wf.jiraSnapshot.key !== runKey) return false;
  return true;
}

/** True when the loaded run belongs to a different task than the page is showing. */
export function runMatchesTask(
  detail: RunDetail | null | undefined,
  projectId: string,
  selectedKey: string | null | undefined,
): boolean {
  if (!detail) return true;
  if (detail.run.projectId !== projectId) return false;
  if (!selectedKey) return true;
  return detail.run.jiraKey === selectedKey;
}
