import { v4 as uuid } from 'uuid';
import type { AiProviderId, Run, RunMode, RunStatus } from '@cpwork/shared';
import { getDb, nowIso } from '../index.js';

interface RunRow {
  id: string;
  project_id: string;
  user_id: string;
  jira_key: string | null;
  mode: string;
  provider: string | null;
  model: string | null;
  status: string;
  branch_name: string | null;
  user_instructions: string | null;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: RunRow): Run {
  return {
    id: row.id,
    projectId: row.project_id,
    userId: row.user_id,
    jiraKey: row.jira_key,
    mode: row.mode as RunMode,
    provider: row.provider as AiProviderId | null,
    model: row.model,
    status: row.status as RunStatus,
    branchName: row.branch_name,
    userInstructions: row.user_instructions,
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateRunInput {
  projectId: string;
  userId: string;
  jiraKey?: string | null;
  mode: RunMode;
  provider?: AiProviderId | null;
  model?: string | null;
  userInstructions?: string | null;
  branchName?: string | null;
  status?: RunStatus;
}

export const runsRepo = {
  findById(id: string): Run | null {
    const row = getDb()
      .prepare('SELECT * FROM runs WHERE id = ?')
      .get(id) as RunRow | undefined;
    return row ? mapRow(row) : null;
  },

  listForUser(userId: string, limit = 50): Run[] {
    const rows = getDb()
      .prepare('SELECT * FROM runs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(userId, limit) as RunRow[];
    return rows.map(mapRow);
  },

  create(input: CreateRunInput): Run {
    const id = uuid();
    const ts = nowIso();
    getDb()
      .prepare(
        `INSERT INTO runs (
          id, project_id, user_id, jira_key, mode, provider, model,
          status, branch_name, user_instructions, created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?, ?,?,?, ?,?)`,
      )
      .run(
        id,
        input.projectId,
        input.userId,
        input.jiraKey ?? null,
        input.mode,
        input.provider ?? null,
        input.model ?? null,
        input.status ?? 'selected',
        input.branchName ?? null,
        input.userInstructions ?? null,
        ts,
        ts,
      );
    return this.findById(id)!;
  },

  updateStatus(id: string, status: RunStatus, summary?: string | null): Run | null {
    const current = this.findById(id);
    if (!current) return null;
    getDb()
      .prepare('UPDATE runs SET status=?, summary=COALESCE(?, summary), updated_at=? WHERE id=?')
      .run(status, summary ?? null, nowIso(), id);
    return this.findById(id);
  },

  setBranch(id: string, branchName: string): void {
    getDb()
      .prepare('UPDATE runs SET branch_name=?, updated_at=? WHERE id=?')
      .run(branchName, nowIso(), id);
  },

  getDetailJson(id: string): string | null {
    const row = getDb()
      .prepare('SELECT detail_json FROM runs WHERE id = ?')
      .get(id) as { detail_json: string | null } | undefined;
    return row?.detail_json ?? null;
  },

  setDetailJson(id: string, json: string): void {
    getDb()
      .prepare('UPDATE runs SET detail_json=?, updated_at=? WHERE id=?')
      .run(json, nowIso(), id);
  },

  setError(id: string, error: string | null): void {
    getDb()
      .prepare('UPDATE runs SET error=?, updated_at=? WHERE id=?')
      .run(error, nowIso(), id);
  },

  getError(id: string): string | null {
    const row = getDb()
      .prepare('SELECT error FROM runs WHERE id = ?')
      .get(id) as { error: string | null } | undefined;
    return row?.error ?? null;
  },
};
