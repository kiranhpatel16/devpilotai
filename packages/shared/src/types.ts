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
  llmConfig: ProjectLlmConfig;
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
  /** auto = detect from changed files; light | standard | full = always use that profile */
  deployProfile?: import('./deployProfile.js').DeployProfileMode;
  /** When true, never run composer install during local deploy */
  deploySkipComposer?: boolean;
}

/** Per-project defaults for AI agent runs (workspace LLM tab). */
export interface ProjectLlmConfig {
  /** @deprecated Use planningProvider — kept for backward compatibility. */
  provider: string | null;
  /** @deprecated Use planningModel — kept for backward compatibility. */
  model: string | null;
  /** Requirement analysis, architecture, plan, and review. */
  planningProvider: string | null;
  planningModel: string | null;
  /** Coding step — file edits (Cursor SDK recommended). */
  codingProvider: string | null;
  codingModel: string | null;
  maxTokens: number | null;
  temperature: number | null;
  topP: number | null;
  /** Prefer JSON object responses from the model (agent modes). */
  jsonMode: boolean;
  /** Override default agent retry count; null = use system default. */
  maxRetries: number | null;
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
  /** Bitbucket username (app password) or Atlassian email (API token) */
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
  | 'deploying'
  | 'deploy_ready'
  | 'deploy_failed'
  | 'paused'
  | 'cancelled'
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

/** Cumulative AI usage for all calls on a workflow run. */
export interface RunUsageTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  creditsUsed: number;
  latencyMs: number;
  callCount: number;
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

export interface TestScreenshot {
  label: string;
  /** Page URL that was captured. */
  url?: string;
  /** API path, e.g. /runs/{id}/screenshots/homepage.png */
  path: string;
  /** Unix timestamp when captured. */
  capturedAt?: number;
}

export interface StorefrontError {
  type?: string;
  message: string;
  file?: string;
  line?: number;
  details?: string[];
}

export interface TestStep {
  key: string;
  label: string;
  ok: boolean;
  skipped: boolean;
  output: string;
  screenshots?: TestScreenshot[];
  /** Prior screenshots kept across re-runs until checks pass. */
  screenshotHistory?: TestScreenshot[];
  /** Parsed Magento exception from storefront HTTP error page. */
  storefrontError?: StorefrontError;
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
  /** Step key currently executing (deploy progress). */
  runningStep?: string | null;
  /** Resolved deploy profile for this run. */
  profile?: import('./deployProfile.js').DeployProfile | null;
  /** Human-readable reason the profile was chosen. */
  profileReason?: string | null;
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
  lastCommitSha?: string | null;
  prUrl: string | null;
  /** True when local changes were stashed before creating the workflow branch. */
  stashed?: boolean;
}

export interface GitCommitRow {
  hash: string;
  fullHash: string;
  message: string;
  author: string | null;
  when: string;
  added: number;
  removed: number;
}

// ----- Run detail (assembled view) -----

/** Provider/model actually used for AI calls (workspace defaults + overrides). */
export interface EffectiveLlm {
  /** Primary display — coding on code steps, planning otherwise. */
  provider: string | null;
  model: string | null;
  planning: { provider: string | null; model: string | null };
  coding: { provider: string | null; model: string | null };
}

export interface RunDetail {
  run: Run;
  /** Resolved LLM for this run; prefer over raw run.provider/model in the UI. */
  effectiveLlm?: EffectiveLlm | null;
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
  /** Sum of all AI calls recorded for this run. */
  usageTotals?: RunUsageTotals | null;
  error: string | null;
  /** Filesystem path when a plan-mode run is saved as markdown. */
  planFilePath: string | null;
  /** Present for 11-step workflow runs. */
  workflow: TaskRunState | null;
}

// ----- Task workflow (SDLC stepper) -----

/** Legacy step ids are kept for in-flight runs; the server migrates them on read. */
export type TaskWorkflowStep =
  | 'select'
  | 'requirement_analysis'
  | 'environment_setup'
  | 'architecture_design'
  | 'development_plan'
  | 'test_cases'
  | 'pre_dev_approval'
  | 'agent'
  | 'deploy'
  | 'code_review'
  | 'commit'
  | 'qa'
  | 'done'
  // legacy (migrated server-side)
  | 'branch'
  | 'describe'
  | 'plan'
  | 'review_plan'
  | 'jira_comment';

export type DevAgentId = 'magento' | 'react' | 'laravel' | 'qa';

export type ApprovalStatus =
  | 'draft'
  | 'pre_dev_pending'
  | 'pre_dev_approved'
  | 'plan_pending'
  | 'plan_approved'
  | 'code_pending'
  | 'code_approved'
  | 'done'
  | 'failed';

export interface RequirementAnalysis {
  summary?: string;
  objective?: string;
  functionalRequirements?: string[];
  nonFunctionalRequirements?: string[];
  businessImpact?: string;
  impactedModules?: string[];
  likelyFiles?: string[];
  risks?: Array<{ level: string; description: string }>;
  assumptions?: string[];
  questions?: string[];
  estimatedComplexity?: 'S' | 'M' | 'L' | 'XL' | string;
}

export interface ArchitectureDesign {
  systemOverview?: string;
  filesToModify?: string[];
  componentDiagram?: string;
  databaseImpact?: string;
  apiChanges?: string[];
  frontendChanges?: string[];
  backendChanges?: string[];
  dependencyMapping?: string[];
  risks?: Array<{ level: string; description: string }>;
}

export interface PlanTask {
  id: string;
  title: string;
  file?: string | null;
  estimatedMinutes?: number;
}

export interface WorkflowTestCase {
  id: string;
  title: string;
  type?: string;
  expected?: string;
  steps?: string;
}

export interface AgentGenerationChunk {
  index: number;
  label: string;
  status: 'pending' | 'running' | 'complete' | 'failed';
  fileCount?: number;
}

export interface AgentGenerationProgress {
  status: 'running' | 'complete' | 'failed';
  currentChunk: number;
  totalChunks: number;
  chunkLabel?: string;
  filesGenerated: number;
  chunks: AgentGenerationChunk[];
}

export interface AiReviewReport {
  issuesFound: number;
  codeQualityScore?: number;
  securityOk?: boolean;
  performanceOk?: boolean;
  magentoStandardsOk?: boolean;
  issues: Array<{ severity: string; message: string; file?: string }>;
  autoFixAvailable?: boolean;
  summary?: string;
}

export interface TaskRunState {
  currentStep: TaskWorkflowStep;
  completedSteps: TaskWorkflowStep[];
  jiraSnapshot: JiraIssueDetail | null;
  customTitle: string | null;
  customTaskKey: string | null;
  customRequirements: string | null;
  requirementAnalysis: RequirementAnalysis | null;
  architectureDesign: ArchitectureDesign | null;
  planMarkdown: string | null;
  planTasks: PlanTask[] | null;
  planFilePath: string | null;
  testCases: WorkflowTestCase[] | null;
  devAgentId: DevAgentId;
  /** When true, run.provider/model were set on setup and override workspace defaults. */
  llmOverride?: boolean;
  /** Coding-step provider/model chosen on setup (overrides workspace coding defaults). */
  codingProvider?: string | null;
  codingModel?: string | null;
  planApprovedAt: string | null;
  planApprovedBy: string | null;
  preDevApprovedAt: string | null;
  preDevApprovedBy: string | null;
  approvalStatus: ApprovalStatus;
  aiReview: AiReviewReport | null;
  jiraCommentPostedAt: string | null;
  jiraCommentId: string | null;
  jiraCommentText: string | null;
  testPassRate: string | null;
  /** Jira key / custom title the pre-dev artifacts were generated for. */
  artifactsForTaskKey?: string | null;
  /** Jira summary / custom title at generation time — used to detect stale artifacts. */
  artifactsForTaskSummary?: string | null;
  /** Progress while the developer agent generates code in plan chunks. */
  agentGeneration?: AgentGenerationProgress | null;
}

export interface TaskHistoryRow {
  runId: string;
  projectId?: string;
  projectName?: string | null;
  userId?: string;
  username?: string | null;
  displayName?: string | null;
  jiraKey: string | null;
  customTitle: string | null;
  customTaskKey: string | null;
  customRequirements: string | null;
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

export interface TaskHistoryFilterUser {
  userId: string;
  username: string;
  displayName: string;
}

export interface TaskHistoryPage {
  rows: TaskHistoryRow[];
  total: number;
  page: number;
  pageSize: number;
  filterUsers: TaskHistoryFilterUser[];
}
