/** Global (system-wide) roles. */
export const GlobalRole = {
  SuperAdmin: 'super_admin',
  Admin: 'admin',
  Developer: 'developer',
  Viewer: 'viewer',
} as const;

export type GlobalRole = (typeof GlobalRole)[keyof typeof GlobalRole];

export const GLOBAL_ROLES: GlobalRole[] = [
  GlobalRole.SuperAdmin,
  GlobalRole.Admin,
  GlobalRole.Developer,
  GlobalRole.Viewer,
];

/** Per-project roles assigned to a user for a specific project. */
export const ProjectRole = {
  Owner: 'owner',
  Developer: 'developer',
  Reviewer: 'reviewer',
  Viewer: 'viewer',
} as const;

export type ProjectRole = (typeof ProjectRole)[keyof typeof ProjectRole];

export const PROJECT_ROLES: ProjectRole[] = [
  ProjectRole.Owner,
  ProjectRole.Developer,
  ProjectRole.Reviewer,
  ProjectRole.Viewer,
];

/** Roles that can access the admin dashboard. */
export function isAdminRole(role: GlobalRole): boolean {
  return role === GlobalRole.SuperAdmin || role === GlobalRole.Admin;
}

/** Project roles allowed to apply/commit/push changes. */
export function canWriteOnProject(role: ProjectRole): boolean {
  return role === ProjectRole.Owner || role === ProjectRole.Developer;
}
