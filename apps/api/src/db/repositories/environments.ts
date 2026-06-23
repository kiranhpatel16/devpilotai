import { v4 as uuid } from 'uuid';
import type { EnvironmentHealth, UserProjectEnvironment } from '@cpwork/shared';
import { getDb, nowIso } from '../index.js';

interface EnvRow {
  id: string;
  user_id: string;
  project_id: string;
  project_root: string;
  frontend_url: string | null;
  backend_url: string | null;
  database_host: string | null;
  database_port: number | null;
  database_name: string | null;
  database_user: string | null;
  database_password_enc: string | null;
  docker_compose_path: string | null;
  php_bin: string | null;
  path_verified_at: string | null;
  last_health_json: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: EnvRow): UserProjectEnvironment {
  let lastHealth: EnvironmentHealth | null = null;
  if (row.last_health_json) {
    try {
      lastHealth = JSON.parse(row.last_health_json);
    } catch {
      lastHealth = null;
    }
  }
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    projectRoot: row.project_root,
    frontendUrl: row.frontend_url,
    backendUrl: row.backend_url,
    databaseHost: row.database_host,
    databasePort: row.database_port,
    databaseName: row.database_name,
    databaseUser: row.database_user,
    dockerComposePath: row.docker_compose_path,
    phpBin: row.php_bin,
    pathVerifiedAt: row.path_verified_at,
    lastHealth,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface EnvironmentInput {
  projectRoot: string;
  frontendUrl?: string | null;
  backendUrl?: string | null;
  databaseHost?: string | null;
  databasePort?: number | null;
  databaseName?: string | null;
  databaseUser?: string | null;
  databasePasswordEnc?: string | null;
  dockerComposePath?: string | null;
  phpBin?: string | null;
}

export const environmentsRepo = {
  find(userId: string, projectId: string): UserProjectEnvironment | null {
    const row = getDb()
      .prepare(
        'SELECT * FROM user_project_environments WHERE user_id = ? AND project_id = ?',
      )
      .get(userId, projectId) as EnvRow | undefined;
    return row ? mapRow(row) : null;
  },

  listForProject(projectId: string): UserProjectEnvironment[] {
    const rows = getDb()
      .prepare('SELECT * FROM user_project_environments WHERE project_id = ?')
      .all(projectId) as EnvRow[];
    return rows.map(mapRow);
  },

  upsert(
    userId: string,
    projectId: string,
    input: EnvironmentInput,
  ): UserProjectEnvironment {
    const existing = this.find(userId, projectId);
    const ts = nowIso();
    if (existing) {
      getDb()
        .prepare(
          `UPDATE user_project_environments SET
            project_root=?, frontend_url=?, backend_url=?,
            database_host=?, database_port=?, database_name=?, database_user=?,
            database_password_enc=COALESCE(?, database_password_enc),
            docker_compose_path=?, php_bin=?, updated_at=?
           WHERE user_id=? AND project_id=?`,
        )
        .run(
          input.projectRoot,
          input.frontendUrl ?? null,
          input.backendUrl ?? null,
          input.databaseHost ?? null,
          input.databasePort ?? null,
          input.databaseName ?? null,
          input.databaseUser ?? null,
          input.databasePasswordEnc ?? null,
          input.dockerComposePath ?? null,
          input.phpBin ?? null,
          ts,
          userId,
          projectId,
        );
      return this.find(userId, projectId)!;
    }
    const id = uuid();
    getDb()
      .prepare(
        `INSERT INTO user_project_environments (
          id, user_id, project_id, project_root, frontend_url, backend_url,
          database_host, database_port, database_name, database_user,
          database_password_enc, docker_compose_path, php_bin,
          created_at, updated_at
        ) VALUES (?,?,?,?,?,?, ?,?,?,?, ?,?,?, ?,?)`,
      )
      .run(
        id,
        userId,
        projectId,
        input.projectRoot,
        input.frontendUrl ?? null,
        input.backendUrl ?? null,
        input.databaseHost ?? null,
        input.databasePort ?? null,
        input.databaseName ?? null,
        input.databaseUser ?? null,
        input.databasePasswordEnc ?? null,
        input.dockerComposePath ?? null,
        input.phpBin ?? null,
        ts,
        ts,
      );
    return this.find(userId, projectId)!;
  },

  saveHealth(
    userId: string,
    projectId: string,
    health: EnvironmentHealth,
  ): void {
    getDb()
      .prepare(
        `UPDATE user_project_environments
         SET last_health_json=?, path_verified_at=?, updated_at=?
         WHERE user_id=? AND project_id=?`,
      )
      .run(
        JSON.stringify(health),
        health.ok ? health.checkedAt : null,
        nowIso(),
        userId,
        projectId,
      );
  },
};
