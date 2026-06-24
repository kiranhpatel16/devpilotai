import type {
  JiraAttachment,
  JiraBoard,
  JiraIssueDetail,
  JiraStatusGroup,
  JiraTask,
  Project,
} from '@cpwork/shared';
import { HttpError } from '../../lib/httpError.js';
import { decryptSecret } from '../../lib/crypto.js';
import { projectsRepo } from '../../db/repositories/projects.js';
import {
  adfToText,
  jiraClient,
  type JiraCredentials,
  type RawJiraIssue,
} from './jira.client.js';

export interface ResolvedJira {
  project: Project;
  creds: JiraCredentials;
}

/** Returns null when Jira is not fully configured for the project. */
export function resolveJira(projectId: string): ResolvedJira | null {
  const project = projectsRepo.findById(projectId);
  if (!project) throw HttpError.notFound('Project not found');

  const tokenEnc = projectsRepo.getJiraTokenEnc(projectId);
  if (!project.jira.baseUrl || !project.jira.email || !tokenEnc) {
    return null;
  }
  const apiToken = decryptSecret(tokenEnc);
  if (!apiToken) return null;

  return {
    project,
    creds: { baseUrl: project.jira.baseUrl, email: project.jira.email, apiToken },
  };
}

function jiraStr(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function browseUrl(baseUrl: string, key: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/browse/${key}`;
}

function mapTask(baseUrl: string, issue: RawJiraIssue): JiraTask {
  const f = issue.fields ?? {};
  const status = (f.status ?? {}) as any;
  const assignee = (f.assignee ?? null) as any;
  const priority = (f.priority ?? null) as any;
  const issuetype = (f.issuetype ?? null) as any;

  return {
    key: issue.key,
    summary: jiraStr(f.summary) ?? '(no summary)',
    status: jiraStr(status?.name) ?? 'Unknown',
    statusCategory: jiraStr(status?.statusCategory?.name) ?? 'Unknown',
    assignee: assignee ? jiraStr(assignee.displayName) : null,
    assigneeEmail: assignee ? jiraStr(assignee.emailAddress) : null,
    priority: priority ? jiraStr(priority.name) : null,
    issueType: issuetype ? jiraStr(issuetype.name) : null,
    updated: jiraStr(f.updated),
    url: browseUrl(baseUrl, issue.key),
  };
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

export interface BoardOptions {
  /** When set, restrict to this assignee (Jira accountId/username or email). */
  assigneeValue?: string | null;
}

/** Build a JQL query from project Jira config + optional assignee override. */
export function buildJql(project: Project, options: BoardOptions = {}): string {
  const clauses: string[] = [];
  if (project.jira.projectKey) {
    clauses.push(`project = ${quote(project.jira.projectKey)}`);
  }
  const statuses = project.jira.statusFilters?.filter(Boolean) ?? [];
  if (statuses.length > 0) {
    clauses.push(`status IN (${statuses.map(quote).join(', ')})`);
  }

  // Per-user assignee filter (My tasks). Only applied when a value is given.
  const assignee = options.assigneeValue?.trim();
  if (assignee) {
    const isFunc = /\)$/.test(assignee); // allow raw JQL functions like currentUser()
    clauses.push(`assignee = ${isFunc ? assignee : quote(assignee)}`);
  }

  const where = clauses.length ? clauses.join(' AND ') : '';
  return where ? `${where} ORDER BY updated DESC` : 'ORDER BY updated DESC';
}

function resolveStatusLabel(configured: string[], taskStatus: string): string {
  const taskLower = (taskStatus || '').trim().toLowerCase();
  const match = configured.find((label) => label.trim().toLowerCase() === taskLower);
  return match ?? taskStatus;
}

export async function getBoard(
  projectId: string,
  options: BoardOptions = {},
): Promise<JiraBoard> {
  const resolved = resolveJira(projectId);
  if (!resolved) {
    return {
      configured: false,
      projectKey: null,
      message: 'Jira is not configured for this project. Ask an admin to add credentials.',
      groups: [],
      total: 0,
    };
  }

  const { project, creds } = resolved;
  const jql = buildJql(project, options);
  const issues = await jiraClient.search(creds, jql, 100);
  const tasks = issues.map((i) => mapTask(creds.baseUrl, i));

  // Group by the project's configured statuses, preserving order; extras at end.
  const order = project.jira.statusFilters?.filter(Boolean) ?? [];
  const groupMap = new Map<string, JiraTask[]>();
  for (const status of order) groupMap.set(status, []);
  for (const task of tasks) {
    const label = resolveStatusLabel(order, task.status);
    if (!groupMap.has(label)) groupMap.set(label, []);
    groupMap.get(label)!.push(task);
  }
  const groups: JiraStatusGroup[] = order.map((status) => ({
    status,
    tasks: groupMap.get(status) ?? [],
  }));
  for (const [status, groupTasks] of groupMap.entries()) {
    if (!order.includes(status)) {
      groups.push({ status, tasks: groupTasks });
    }
  }

  return {
    configured: true,
    projectKey: project.jira.projectKey,
    groups,
    total: tasks.length,
  };
}

function mapAttachments(baseUrl: string, raw: unknown): JiraAttachment[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((a: any) => {
    const mimeType = jiraStr(a.mimeType);
    return {
      id: String(a.id),
      filename: jiraStr(a.filename) ?? 'attachment',
      mimeType,
      size: typeof a.size === 'number' ? a.size : null,
      url: jiraStr(a.content) ?? '',
      isImage: !!mimeType && mimeType.startsWith('image/'),
    };
  });
}

export async function getIssueDetail(
  projectId: string,
  key: string,
): Promise<JiraIssueDetail> {
  const resolved = resolveJira(projectId);
  if (!resolved) {
    throw new HttpError(409, 'Jira is not configured for this project', 'jira_not_configured');
  }
  const { creds } = resolved;
  const issue = await jiraClient.getIssue(creds, key);
  const base = mapTask(creds.baseUrl, issue);
  const f = issue.fields ?? {};

  const labels = Array.isArray(f.labels) ? (f.labels as string[]) : [];
  const components = Array.isArray(f.components)
    ? (f.components as any[]).map((c) => jiraStr(c?.name) ?? '').filter(Boolean)
    : [];

  return {
    ...base,
    description: adfToText(f.description),
    labels,
    components,
    attachments: mapAttachments(creds.baseUrl, f.attachment),
  };
}

export async function testConnection(creds: JiraCredentials) {
  return jiraClient.verify(creds);
}
