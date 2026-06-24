const STORAGE_KEY = 'devpilot_last_workspace_id';

export function getLastWorkspaceId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setLastWorkspaceId(projectId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, projectId);
  } catch {
    /* ignore */
  }
}
