import { v4 as uuid } from 'uuid';
import type { ProjectRole, UserProjectRoleAssignment } from '@cpwork/shared';
import { getDb, nowIso } from '../index.js';

interface RoleJoinRow {
  project_id: string;
  project_role: string;
  name: string;
  slug: string;
}

export const projectRolesRepo = {
  listForUser(userId: string): UserProjectRoleAssignment[] {
    const rows = getDb()
      .prepare(
        `SELECT upr.project_id, upr.project_role, p.name, p.slug
         FROM user_project_roles upr
         JOIN projects p ON p.id = upr.project_id
         WHERE upr.user_id = ?
         ORDER BY p.name ASC`,
      )
      .all(userId) as RoleJoinRow[];
    return rows.map((r) => ({
      projectId: r.project_id,
      projectName: r.name,
      projectSlug: r.slug,
      role: r.project_role as ProjectRole,
    }));
  },

  getRole(userId: string, projectId: string): ProjectRole | null {
    const row = getDb()
      .prepare(
        'SELECT project_role FROM user_project_roles WHERE user_id = ? AND project_id = ?',
      )
      .get(userId, projectId) as { project_role: string } | undefined;
    return row ? (row.project_role as ProjectRole) : null;
  },

  countUsersForProject(projectId: string): number {
    const r = getDb()
      .prepare('SELECT COUNT(*) AS n FROM user_project_roles WHERE project_id = ?')
      .get(projectId) as { n: number };
    return r.n;
  },

  /** Replace all of a user's project role assignments with the provided set. */
  setForUser(
    userId: string,
    assignments: { projectId: string; role: ProjectRole }[],
    assignedBy: string | null,
  ): void {
    const db = getDb();
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM user_project_roles WHERE user_id = ?').run(userId);
      const insert = db.prepare(
        `INSERT INTO user_project_roles
          (id, user_id, project_id, project_role, assigned_by, assigned_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const a of assignments) {
        insert.run(uuid(), userId, a.projectId, a.role, assignedBy, nowIso());
      }
    });
    tx();
  },
};
