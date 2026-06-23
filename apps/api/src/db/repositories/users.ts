import { v4 as uuid } from 'uuid';
import type { GlobalRole, PublicUser, UserStatus } from '@cpwork/shared';
import { getDb, nowIso } from '../index.js';

interface UserRow {
  id: string;
  username: string;
  email: string | null;
  display_name: string;
  password_hash: string;
  global_role: string;
  status: string;
  must_change_password: number;
  jira_account_id: string | null;
  failed_login_attempts: number;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserWithSecret extends PublicUser {
  passwordHash: string;
  failedLoginAttempts: number;
  lockedUntil: string | null;
}

function mapRow(row: UserRow): UserWithSecret {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.display_name,
    globalRole: row.global_role as GlobalRole,
    status: row.status as UserStatus,
    mustChangePassword: !!row.must_change_password,
    jiraAccountId: row.jira_account_id,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    passwordHash: row.password_hash,
    failedLoginAttempts: row.failed_login_attempts,
    lockedUntil: row.locked_until,
  };
}

export function toPublicUser(user: UserWithSecret): PublicUser {
  const { passwordHash, failedLoginAttempts, lockedUntil, ...rest } = user;
  void passwordHash;
  void failedLoginAttempts;
  void lockedUntil;
  return rest;
}

export interface CreateUserInput {
  username: string;
  email?: string | null;
  displayName: string;
  passwordHash: string;
  globalRole: GlobalRole;
  status?: UserStatus;
  mustChangePassword?: boolean;
}

export const usersRepo = {
  findById(id: string): UserWithSecret | null {
    const row = getDb()
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(id) as UserRow | undefined;
    return row ? mapRow(row) : null;
  },

  findByUsername(username: string): UserWithSecret | null {
    const row = getDb()
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username) as UserRow | undefined;
    return row ? mapRow(row) : null;
  },

  list(): PublicUser[] {
    const rows = getDb()
      .prepare('SELECT * FROM users ORDER BY created_at ASC')
      .all() as UserRow[];
    return rows.map((r) => toPublicUser(mapRow(r)));
  },

  countByRole(role: GlobalRole): number {
    const r = getDb()
      .prepare('SELECT COUNT(*) AS n FROM users WHERE global_role = ?')
      .get(role) as { n: number };
    return r.n;
  },

  create(input: CreateUserInput): UserWithSecret {
    const id = uuid();
    const ts = nowIso();
    getDb()
      .prepare(
        `INSERT INTO users
          (id, username, email, display_name, password_hash, global_role,
           status, must_change_password, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.username,
        input.email ?? null,
        input.displayName,
        input.passwordHash,
        input.globalRole,
        input.status ?? 'active',
        input.mustChangePassword ? 1 : 0,
        ts,
        ts,
      );
    return this.findById(id)!;
  },

  update(
    id: string,
    fields: Partial<{
      email: string | null;
      displayName: string;
      globalRole: GlobalRole;
      status: UserStatus;
      passwordHash: string;
      mustChangePassword: boolean;
    }>,
  ): UserWithSecret | null {
    const current = this.findById(id);
    if (!current) return null;
    getDb()
      .prepare(
        `UPDATE users SET
          email = ?, display_name = ?, global_role = ?, status = ?,
          password_hash = ?, must_change_password = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        fields.email !== undefined ? fields.email : current.email,
        fields.displayName ?? current.displayName,
        fields.globalRole ?? current.globalRole,
        fields.status ?? current.status,
        fields.passwordHash ?? current.passwordHash,
        (fields.mustChangePassword ?? current.mustChangePassword) ? 1 : 0,
        nowIso(),
        id,
      );
    return this.findById(id);
  },

  setJiraAccountId(id: string, jiraAccountId: string | null): UserWithSecret | null {
    getDb()
      .prepare('UPDATE users SET jira_account_id = ?, updated_at = ? WHERE id = ?')
      .run(jiraAccountId, nowIso(), id);
    return this.findById(id);
  },

  recordLoginSuccess(id: string): void {
    getDb()
      .prepare(
        `UPDATE users SET last_login_at = ?, failed_login_attempts = 0,
          locked_until = NULL, updated_at = ? WHERE id = ?`,
      )
      .run(nowIso(), nowIso(), id);
  },

  recordLoginFailure(id: string, attempts: number, lockedUntil: string | null): void {
    getDb()
      .prepare(
        `UPDATE users SET failed_login_attempts = ?, locked_until = ?,
          updated_at = ? WHERE id = ?`,
      )
      .run(attempts, lockedUntil, nowIso(), id);
  },
};
