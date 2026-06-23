import { HttpError } from '../../lib/httpError.js';

export interface JiraCredentials {
  baseUrl: string;
  email: string;
  apiToken: string;
}

/** Raw Jira issue shape (subset we care about). */
export interface RawJiraIssue {
  key: string;
  fields: Record<string, unknown>;
}

function authHeader(creds: JiraCredentials): string {
  const token = Buffer.from(`${creds.email}:${creds.apiToken}`).toString('base64');
  return `Basic ${token}`;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

async function request<T>(
  creds: JiraCredentials,
  pathName: string,
  init: RequestInit = {},
): Promise<T> {
  const url = `${normalizeBaseUrl(creds.baseUrl)}${pathName}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Authorization: authHeader(creds),
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    throw new HttpError(
      502,
      `Could not reach Jira at ${creds.baseUrl}`,
      'jira_unreachable',
      { cause: err instanceof Error ? err.message : String(err) },
    );
  }

  if (res.status === 401 || res.status === 403) {
    throw new HttpError(
      502,
      'Jira authentication failed. Check email and API token.',
      'jira_auth_failed',
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new HttpError(502, `Jira request failed (${res.status})`, 'jira_error', {
      status: res.status,
      body: text.slice(0, 500),
    });
  }
  return (await res.json()) as T;
}

export interface JqlSearchResponse {
  issues: RawJiraIssue[];
  total?: number;
  nextPageToken?: string;
}

const ISSUE_FIELDS = [
  'summary',
  'status',
  'assignee',
  'priority',
  'issuetype',
  'updated',
];

const DETAIL_FIELDS = [...ISSUE_FIELDS, 'description', 'attachment', 'labels', 'components'];

export const jiraClient = {
  /** Search issues using the current /rest/api/3/search/jql endpoint. */
  async search(
    creds: JiraCredentials,
    jql: string,
    maxResults = 50,
  ): Promise<RawJiraIssue[]> {
    const data = await request<JqlSearchResponse>(creds, '/rest/api/3/search/jql', {
      method: 'POST',
      body: JSON.stringify({ jql, maxResults, fields: ISSUE_FIELDS }),
    });
    return data.issues ?? [];
  },

  async getIssue(creds: JiraCredentials, key: string): Promise<RawJiraIssue> {
    const fields = DETAIL_FIELDS.join(',');
    return request<RawJiraIssue>(
      creds,
      `/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fields}`,
    );
  },

  /** Lightweight call used to verify credentials. */
  async verify(creds: JiraCredentials): Promise<{ accountId: string; displayName: string }> {
    return request<{ accountId: string; displayName: string }>(
      creds,
      '/rest/api/3/myself',
    );
  },
};

/**
 * Convert Atlassian Document Format (ADF) to plain text.
 * Handles paragraphs, headings, lists, and inline text/links.
 */
export function adfToText(adf: unknown): string {
  if (!adf || typeof adf !== 'object') {
    return typeof adf === 'string' ? adf : '';
  }
  const lines: string[] = [];

  function walk(node: any, listPrefix = ''): void {
    if (!node) return;
    const type = node.type as string | undefined;

    if (type === 'text') {
      lines.push(node.text ?? '');
      return;
    }
    if (type === 'hardBreak') {
      lines.push('\n');
      return;
    }
    if (type === 'mention') {
      lines.push(`@${node.attrs?.text ?? node.attrs?.id ?? ''}`);
      return;
    }

    const children: any[] = Array.isArray(node.content) ? node.content : [];

    if (type === 'bulletList' || type === 'orderedList') {
      children.forEach((item, idx) => {
        const prefix = type === 'orderedList' ? `${idx + 1}. ` : '- ';
        walk(item, prefix);
      });
      return;
    }
    if (type === 'listItem') {
      lines.push(`\n${listPrefix}`);
      children.forEach((c) => walk(c, listPrefix));
      return;
    }

    children.forEach((c) => walk(c, listPrefix));

    if (
      type === 'paragraph' ||
      type === 'heading' ||
      type === 'codeBlock' ||
      type === 'blockquote'
    ) {
      lines.push('\n');
    }
  }

  walk(adf);
  return lines
    .join('')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
