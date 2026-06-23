import { v4 as uuid } from 'uuid';
import type { Activity } from '@cpwork/shared';
import { getDb, nowIso } from '../index.js';

interface ActivityRow {
  id: string;
  user_id: string | null;
  username: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  project_id: string | null;
  project_name: string | null;
  jira_key: string | null;
  summary: string;
  metadata_json: string | null;
  ip_address: string | null;
  created_at: string;
}

function mapRow(row: ActivityRow): Activity {
  let metadata: Record<string, unknown> | null = null;
  if (row.metadata_json) {
    try {
      metadata = JSON.parse(row.metadata_json);
    } catch {
      metadata = null;
    }
  }
  return {
    id: row.id,
    userId: row.user_id,
    username: row.username,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    projectId: row.project_id,
    projectName: row.project_name,
    jiraKey: row.jira_key,
    summary: row.summary,
    metadata,
    ipAddress: row.ip_address,
    createdAt: row.created_at,
  };
}

export interface ActivityInput {
  userId?: string | null;
  username?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  jiraKey?: string | null;
  summary: string;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

export const activitiesRepo = {
  create(input: ActivityInput): Activity {
    const id = uuid();
    getDb()
      .prepare(
        `INSERT INTO activities (
          id, user_id, username, action, resource_type, resource_id,
          project_id, project_name, jira_key, summary, metadata_json,
          ip_address, created_at
        ) VALUES (?,?,?,?,?,?, ?,?,?,?,?, ?,?)`,
      )
      .run(
        id,
        input.userId ?? null,
        input.username ?? null,
        input.action,
        input.resourceType ?? null,
        input.resourceId ?? null,
        input.projectId ?? null,
        input.projectName ?? null,
        input.jiraKey ?? null,
        input.summary,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.ipAddress ?? null,
        nowIso(),
      );
    return getDb()
      .prepare('SELECT * FROM activities WHERE id = ?')
      .get(id) as never as Activity;
  },

  recent(limit = 5): Activity[] {
    const rows = getDb()
      .prepare('SELECT * FROM activities ORDER BY created_at DESC LIMIT ?')
      .all(limit) as ActivityRow[];
    return rows.map(mapRow);
  },
};
