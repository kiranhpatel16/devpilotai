import { v4 as uuid } from 'uuid';
import type { Project } from '@cpwork/shared';
import { getDb, nowIso } from '../index.js';

interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  enabled: number;
  frontend_theme: string | null;
  default_project_root: string;
  default_frontend_url: string | null;
  default_backend_url: string | null;
  default_docker_compose: string | null;
  default_docker_patch_id: string | null;
  git_remote: string;
  git_production_branch: string;
  git_staging_branch: string;
  git_pr_target_branch: string;
  git_commit_template: string;
  jira_base_url: string | null;
  jira_project_key: string | null;
  jira_email: string | null;
  jira_status_filters: string;
  jira_assignee_filter: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: ProjectRow): Project {
  let statusFilters: string[] = [];
  try {
    statusFilters = JSON.parse(row.jira_status_filters);
  } catch {
    statusFilters = [];
  }
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    enabled: !!row.enabled,
    frontendTheme: row.frontend_theme,
    defaults: {
      projectRoot: row.default_project_root,
      frontendUrl: row.default_frontend_url,
      backendUrl: row.default_backend_url,
      dockerComposePath: row.default_docker_compose,
      dockerPatchId: row.default_docker_patch_id,
    },
    git: {
      remote: row.git_remote,
      productionBranch: row.git_production_branch,
      stagingBranch: row.git_staging_branch,
      prTargetBranch: row.git_pr_target_branch,
      commitMessageTemplate: row.git_commit_template,
    },
    jira: {
      baseUrl: row.jira_base_url,
      projectKey: row.jira_project_key,
      email: row.jira_email,
      statusFilters,
      assigneeFilter: row.jira_assignee_filter,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ProjectInput {
  name: string;
  slug: string;
  description?: string | null;
  enabled?: boolean;
  frontendTheme?: string | null;
  defaults?: Partial<Project['defaults']>;
  git?: Partial<Project['git']>;
  jira?: Partial<Project['jira']>;
}

export const projectsRepo = {
  findById(id: string): Project | null {
    const row = getDb()
      .prepare('SELECT * FROM projects WHERE id = ?')
      .get(id) as ProjectRow | undefined;
    return row ? mapRow(row) : null;
  },

  findBySlug(slug: string): Project | null {
    const row = getDb()
      .prepare('SELECT * FROM projects WHERE slug = ?')
      .get(slug) as ProjectRow | undefined;
    return row ? mapRow(row) : null;
  },

  list(): Project[] {
    const rows = getDb()
      .prepare('SELECT * FROM projects ORDER BY name ASC')
      .all() as ProjectRow[];
    return rows.map(mapRow);
  },

  listByIds(ids: string[]): Project[] {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(',');
    const rows = getDb()
      .prepare(`SELECT * FROM projects WHERE id IN (${placeholders}) ORDER BY name ASC`)
      .all(...ids) as ProjectRow[];
    return rows.map(mapRow);
  },

  create(input: ProjectInput): Project {
    const id = uuid();
    const ts = nowIso();
    getDb()
      .prepare(
        `INSERT INTO projects (
          id, name, slug, description, enabled, frontend_theme,
          default_project_root, default_frontend_url, default_backend_url,
          default_docker_compose, default_docker_patch_id,
          git_remote, git_production_branch, git_staging_branch,
          git_pr_target_branch, git_commit_template,
          jira_base_url, jira_project_key, jira_email,
          jira_status_filters, jira_assignee_filter,
          created_at, updated_at
        ) VALUES (?,?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?,?,?,?, ?,?)`,
      )
      .run(
        id,
        input.name,
        input.slug,
        input.description ?? null,
        input.enabled === false ? 0 : 1,
        input.frontendTheme ?? null,
        input.defaults?.projectRoot ?? '',
        input.defaults?.frontendUrl ?? null,
        input.defaults?.backendUrl ?? null,
        input.defaults?.dockerComposePath ?? null,
        input.defaults?.dockerPatchId ?? null,
        input.git?.remote ?? 'origin',
        input.git?.productionBranch ?? 'production',
        input.git?.stagingBranch ?? 'staging',
        input.git?.prTargetBranch ?? 'staging',
        input.git?.commitMessageTemplate ?? '[{jiraKey}] {summary}',
        input.jira?.baseUrl ?? null,
        input.jira?.projectKey ?? null,
        input.jira?.email ?? null,
        JSON.stringify(input.jira?.statusFilters ?? ['To Do', 'In Progress', 'Unit Testing']),
        input.jira?.assigneeFilter ?? null,
        ts,
        ts,
      );
    return this.findById(id)!;
  },

  getJiraTokenEnc(id: string): string | null {
    const row = getDb()
      .prepare('SELECT jira_api_token_enc FROM projects WHERE id = ?')
      .get(id) as { jira_api_token_enc: string | null } | undefined;
    return row?.jira_api_token_enc ?? null;
  },

  setJiraTokenEnc(id: string, enc: string | null): void {
    getDb()
      .prepare('UPDATE projects SET jira_api_token_enc = ?, updated_at = ? WHERE id = ?')
      .run(enc, nowIso(), id);
  },

  hasJiraToken(id: string): boolean {
    return !!this.getJiraTokenEnc(id);
  },

  update(id: string, input: ProjectInput): Project | null {
    const current = this.findById(id);
    if (!current) return null;
    const merged: Project = {
      ...current,
      name: input.name ?? current.name,
      slug: input.slug ?? current.slug,
      description: input.description !== undefined ? input.description : current.description,
      enabled: input.enabled !== undefined ? input.enabled : current.enabled,
      frontendTheme:
        input.frontendTheme !== undefined ? input.frontendTheme : current.frontendTheme,
      defaults: { ...current.defaults, ...input.defaults },
      git: { ...current.git, ...input.git },
      jira: { ...current.jira, ...input.jira },
    };
    getDb()
      .prepare(
        `UPDATE projects SET
          name=?, slug=?, description=?, enabled=?, frontend_theme=?,
          default_project_root=?, default_frontend_url=?, default_backend_url=?,
          default_docker_compose=?, default_docker_patch_id=?,
          git_remote=?, git_production_branch=?, git_staging_branch=?,
          git_pr_target_branch=?, git_commit_template=?,
          jira_base_url=?, jira_project_key=?, jira_email=?,
          jira_status_filters=?, jira_assignee_filter=?,
          updated_at=?
         WHERE id=?`,
      )
      .run(
        merged.name,
        merged.slug,
        merged.description,
        merged.enabled ? 1 : 0,
        merged.frontendTheme,
        merged.defaults.projectRoot,
        merged.defaults.frontendUrl,
        merged.defaults.backendUrl,
        merged.defaults.dockerComposePath,
        merged.defaults.dockerPatchId,
        merged.git.remote,
        merged.git.productionBranch,
        merged.git.stagingBranch,
        merged.git.prTargetBranch,
        merged.git.commitMessageTemplate,
        merged.jira.baseUrl,
        merged.jira.projectKey,
        merged.jira.email,
        JSON.stringify(merged.jira.statusFilters),
        merged.jira.assigneeFilter,
        nowIso(),
        id,
      );
    return this.findById(id);
  },
};
