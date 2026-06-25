/** Stable URL for a custom (non-Jira) workflow task — survives page refresh. */
export function customTaskPath(projectId: string, runId: string): string {
  const params = new URLSearchParams({ type: 'custom', runId });
  return `/workspaces/${projectId}/tasks/_custom?${params.toString()}`;
}
