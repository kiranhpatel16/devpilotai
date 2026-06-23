/** Canonical activity action identifiers used across API and UI. */
export const ActivityAction = {
  AuthLogin: 'auth.login',
  AuthLogout: 'auth.logout',
  AuthLoginFailed: 'auth.login_failed',
  AuthPasswordReset: 'auth.password_reset',

  UserCreated: 'user.created',
  UserUpdated: 'user.updated',
  UserRoleChanged: 'user.role_changed',
  UserEnvironmentUpdated: 'user.environment_updated',

  ProjectCreated: 'project.created',
  ProjectUpdated: 'project.updated',

  RunStarted: 'run.started',
  RunApplied: 'run.applied',
  RunRejected: 'run.rejected',
  RunCommitted: 'run.committed',
  RunPushed: 'run.pushed',
  RunPrCreated: 'run.pr_created',
  RunFailed: 'run.failed',
} as const;

export type ActivityAction =
  (typeof ActivityAction)[keyof typeof ActivityAction];
