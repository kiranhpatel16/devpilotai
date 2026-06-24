import type { GlobalRole, ProjectRole } from './roles.js';

export type UserStatus = 'active' | 'disabled' | 'locked';

export interface User {
  id: string;
  username: string;
  email: string | null;
  displayName: string;
  globalRole: GlobalRole;
  status: UserStatus;
  mustChangePassword: boolean;
  /** The user's Jira identity (accountId for Jira Cloud, username for Server/DC). */
  jiraAccountId: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** User shape safe to return to the client (never includes password hash). */
export type PublicUser = User;

export interface AuthSession {
  user: PublicUser;
  projectRoles: UserProjectRoleAssignment[];
}

export interface UserProjectRoleAssignment {
  projectId: string;
  projectName: string;
  projectSlug: string;
  role: ProjectRole;
}

/** Shared/logical project (admin-managed). Paths here are defaults/templates. */
export interface Project {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  enabled: boolean;
  /** Active frontend theme path, e.g. "BlueAcorn/site" or "CP/colemans". */
  frontendTheme: string | null;
  defaults: ProjectDefaults;
  git: ProjectGitConfig;
  jira: ProjectJiraConfig;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectDefaults {
  projectRoot: string;
  frontendUrl: string | null;
  backendUrl: string | null;
  dockerComposePath: string | null;
  dockerPatchId: string | null;
}

export interface ProjectGitConfig {
  remote: string;
  productionBranch: string;
  stagingBranch: string;
  prTargetBranch: string;
  commitMessageTemplate: string;
  /** github | bitbucket — used for REST API PR creation */
  prProvider: 'github' | 'bitbucket' | null;
  /** Bitbucket workspace or GitHub org/user */
  repoOwner: string | null;
  /** Repository slug */
  repoName: string | null;
  /** Bitbucket username for app password auth */
  apiUsername: string | null;
}

export interface ProjectJiraConfig {
  baseUrl: string | null;
  projectKey: string | null;
  email: string | null;
  statusFilters: string[];
  assigneeFilter: string | null;
}

/** Per-project AI prompt rules (admin-managed). When absent, system defaults apply. */
export interface ProjectAiRules {
  id: string;
  projectId: string;
  implementationQualityRules: string | null;
  magentoRules: string | null;
  agentOutputContract: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectAiRulesEditable {
  implementationQualityRules: string;
  magentoRules: string;
  agentOutputContract: string;
}

export interface ProjectAiRulesSummary {
  id: string;
  name: string;
  slug: string;
  hasCustomAiRules: boolean;
  updatedAt: string | null;
}

/** Per-user local environment for a project (the Kiran vs Bhavesh path layer). */
export interface UserProjectEnvironment {
  id: string;
  userId: string;
  projectId: string;
  projectRoot: string;
  frontendUrl: string | null;
  backendUrl: string | null;
  databaseHost: string | null;
  databasePort: number | null;
  databaseName: string | null;
  databaseUser: string | null;
  dockerComposePath: string | null;
  phpBin: string | null;
  pathVerifiedAt: string | null;
  lastHealth: EnvironmentHealth | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnvironmentHealthCheck {
  key: string;
  label: string;
  ok: boolean;
  detail?: string;
}

export interface EnvironmentHealth {
  checkedAt: string;
  ok: boolean;
  checks: EnvironmentHealthCheck[];
}

export type RunMode = 'agent' | 'plan' | 'debug' | 'ask' | 'workflow';
export type AiProviderId = 'cursor' | 'grok' | 'openai' | 'cloud_ai';

export type RunStatus =
  | 'selected'
  | 'branching'
  | 'analyzing'
  | 'awaiting_review'
  | 'applying'
  | 'testing'
  | 'commit_ready'
  | 'pushing'
  | 'pr_creating'
  | 'done'
  | 'rejected'
  | 'failed';

export interface Run {
  id: string;
  projectId: string;
  userId: string;
  jiraKey: string | null;
  mode: RunMode;
  provider: AiProviderId | null;
  model: string | null;
  status: RunStatus;
  branchName: string | null;
  userInstructions: string | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Activity {
  id: string;
  userId: string | null;
  username: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  projectId: string | null;
  projectName: string | null;
  jiraKey: string | null;
  summary: string;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface ApiError {
  error: string;
  code?: string;
  details?: unknown;
}

// ----- Jira -----

export interface JiraTask {
  key: string;
  summary: string;
  status: string;
  statusCategory: string; // "To Do" | "In Progress" | "Done" (Jira category)
  assignee: string | null;
  assigneeEmail: string | null;
  priority: string | null;
  issueType: string | null;
  updated: string | null;
  url: string;
}

export interface JiraAttachment {
  id: string;
  filename: string;
  mimeType: string | null;
  size: number | null;
  url: string;
  isImage: boolean;
}

export interface JiraIssueDetail extends JiraTask {
  description: string;
  labels: string[];
  components: string[];
  attachments: JiraAttachment[];
}

export interface JiraStatusGroup {
  status: string;
  tasks: JiraTask[];
}

export interface JiraBoard {
  configured: boolean;
  projectKey: string | null;
  message?: string;
  groups: JiraStatusGroup[];
  total: number;
  scope?: 'mine' | 'all';
  needsJiraIdentity?: boolean;
}

// ----- AI providers -----

export interface AiProviderInfo {
  id: string;
  label: string;
  enabled: boolean;
  configured: boolean;
  defaultModel: string | null;
  /** Saved override base URL, if any. */
  baseUrl?: string | null;
  /** Provider catalog default API base URL. */
  defaultBaseUrl?: string | null;
  models: string[];
  /** Whether this provider can run the file-editing Agent mode in this build. */
  supportsAgent: boolean;
  /** User-defined OpenAI-compatible provider (can be deleted). */
  custom?: boolean;
  /** Whether this provider can be removed from the system. */
  deletable?: boolean;
}

export type FileChangeAction = 'create' | 'modify' | 'delete';

/** A targeted search/replace within an existing file. */
export interface FileEdit {
  /** Exact existing text to locate (copied verbatim from the current file). */
  oldString: string;
  /** Replacement text. */
  newString: string;
  /** Replace every occurrence instead of the first. */
  replaceAll?: boolean;
}

export interface ProposedFileChange {
  path: string;
  action: FileChangeAction;
  reason: string | null;
  /** Full file content — used for `create` (and as a fallback for `modify`). */
  content: string | null;
  /** Targeted edits — preferred for `modify` so the rest of the file is preserved. */
  edits?: FileEdit[];
}

/** Normalized AI output for any provider. */
export interface AgentOutput {
  summary: string;
  files: ProposedFileChange[];
  manualTestChecklist: string[];
  risks: string[];
  /** Free-form text answer (used by plan/ask/debug modes). */
  text: string | null;
  /** Quality issues that block apply until fixed. */
  validationErrors?: string[];
  /** Suggestions (e.g. missing tests) — apply is still allowed. */
  validationWarnings?: string[];
}

export interface AiUsage {
  provider: AiProviderId;
  model: string;
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
}

// ----- Diffs / review -----

export interface FileDiff {
  path: string;
  action: FileChangeAction;
  reason: string | null;
  /** Unified diff text (current working tree vs proposed). */
  patch: string;
  added: number;
  removed: number;
  /** Set when the proposed edit could not be located/applied to the current file. */
  error: string | null;
}

// ----- Testing -----

export interface TestStep {
  key: string;
  label: string;
  ok: boolean;
  skipped: boolean;
  output: string;
}

export interface DeployFailureIssue {
  kind: string;
  message: string;
  autoFixable?: boolean;
  file?: string | null;
  reportedPath?: string | null;
  lines?: number[];
  module?: string;
  rawExcerpt?: string;
}

export interface DeployFailureAnalysis {
  failedStep: string | null;
  summary: string;
  issues: DeployFailureIssue[];
  /** Repository-relative paths extracted from the deploy error output. */
  errorFiles?: string[];
  autoFixable?: boolean;
  /** True when AI agent can attempt a fix for this deploy failure. */
  aiFixable?: boolean;
  rawOutput?: string;
}

export interface TestReport {
  ranAt: string;
  ok: boolean;
  steps: TestStep[];
  /** True while a local deploy job is still running. */
  running?: boolean;
  error?: string | null;
  /** Parsed diagnosis when a deploy fails (workflow deploy step). */
  analysis?: DeployFailureAnalysis | null;
}

// ----- Git -----

export interface GitInfo {
  branch: string | null;
  baseBranch: string;
  ahead: number;
  behind: number;
  staged: number;
  changedFiles: string[];
  committed: boolean;
  pushed: boolean;
  commitMessage: string | null;
  prUrl: string | null;
  /** True when local changes were stashed before creating the workflow branch. */
  stashed?: boolean;
}

// ----- Run detail (assembled view) -----

export interface RunDetail {
  run: Run;
  output: AgentOutput | null;
  diffs: FileDiff[];
  applied: boolean;
  /** True when applied changes can still be reverted (not yet committed). */
  canRevert: boolean;
  test: TestReport | null;
  /** Local Magento deploy report (workflow deploy step). */
  deploy: TestReport | null;
  git: GitInfo | null;
  usage: AiUsage | null;
  error: string | null;
  /** Filesystem path when a plan-mode run is saved as markdown. */
  planFilePath: string | null;
  /** Present for 11-step workflow runs. */
  workflow: TaskRunState | null;
}

// ----- Task workflow (11-step stepper) -----

export type TaskWorkflowStep =
  | 'select'
  | 'branch'
  | 'describe'
  | 'plan'
  | 'review_plan'
  | 'agent'
  | 'code_review'
  | 'deploy'
  | 'commit'
  | 'jira_comment'
  | 'done';

export type ApprovalStatus =
  | 'draft'
  | 'plan_pending'
  | 'plan_approved'
  | 'code_pending'
  | 'code_approved'
  | 'done'
  | 'failed';

export interface TaskRunState {
  currentStep: TaskWorkflowStep;
  completedSteps: TaskWorkflowStep[];
  jiraSnapshot: JiraIssueDetail | null;
  customTitle: string | null;
  planMarkdown: string | null;
  planFilePath: string | null;
  planApprovedAt: string | null;
  planApprovedBy: string | null;
  approvalStatus: ApprovalStatus;
  jiraCommentPostedAt: string | null;
  jiraCommentId: string | null;
  jiraCommentText: string | null;
  testPassRate: string | null;
}

export interface TaskHistoryRow {
  runId: string;
  jiraKey: string | null;
  branchName: string | null;
  provider: string | null;
  model: string | null;
  approvalStatus: ApprovalStatus;
  testPassRate: string | null;
  currentStep: TaskWorkflowStep;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}
