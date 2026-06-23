import uuid
import json
from database import get_db, now_iso


def _map_row(row) -> dict:
    try:
        status_filters = json.loads(row["jira_status_filters"])
    except Exception:
        status_filters = []
    return {
        "id": row["id"],
        "name": row["name"],
        "slug": row["slug"],
        "description": row["description"],
        "enabled": bool(row["enabled"]),
        "frontendTheme": row["frontend_theme"],
        "defaults": {
            "projectRoot": row["default_project_root"],
            "frontendUrl": row["default_frontend_url"],
            "backendUrl": row["default_backend_url"],
            "dockerComposePath": row["default_docker_compose"],
            "dockerPatchId": row["default_docker_patch_id"],
        },
        "git": {
            "remote": row["git_remote"],
            "productionBranch": row["git_production_branch"],
            "stagingBranch": row["git_staging_branch"],
            "prTargetBranch": row["git_pr_target_branch"],
            "commitMessageTemplate": row["git_commit_template"],
            "prProvider": row["git_pr_provider"] if "git_pr_provider" in row.keys() else None,
            "repoOwner": row["git_repo_owner"] if "git_repo_owner" in row.keys() else None,
            "repoName": row["git_repo_name"] if "git_repo_name" in row.keys() else None,
            "apiUsername": row["git_api_username"] if "git_api_username" in row.keys() else None,
        },
        "jira": {
            "baseUrl": row["jira_base_url"],
            "projectKey": row["jira_project_key"],
            "email": row["jira_email"],
            "statusFilters": status_filters,
            "assigneeFilter": row["jira_assignee_filter"],
        },
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


class _ProjectsRepo:
    def find_by_id(self, project_id: str) -> dict | None:
        row = get_db().execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        return _map_row(row) if row else None

    def find_by_slug(self, slug: str) -> dict | None:
        row = get_db().execute("SELECT * FROM projects WHERE slug = ?", (slug,)).fetchone()
        return _map_row(row) if row else None

    def list_all(self) -> list[dict]:
        rows = get_db().execute("SELECT * FROM projects ORDER BY name ASC").fetchall()
        return [_map_row(r) for r in rows]

    def list_by_ids(self, ids: list[str]) -> list[dict]:
        if not ids:
            return []
        placeholders = ",".join("?" * len(ids))
        rows = get_db().execute(
            f"SELECT * FROM projects WHERE id IN ({placeholders}) ORDER BY name ASC", ids
        ).fetchall()
        return [_map_row(r) for r in rows]

    def create(self, input: dict) -> dict:
        pid = str(uuid.uuid4())
        ts = now_iso()
        jira = input.get("jira") or {}
        git = input.get("git") or {}
        defaults = input.get("defaults") or {}
        db = get_db()
        db.execute(
            """INSERT INTO projects (
                id, name, slug, description, enabled, frontend_theme,
                default_project_root, default_frontend_url, default_backend_url,
                default_docker_compose, default_docker_patch_id,
                git_remote, git_production_branch, git_staging_branch,
                git_pr_target_branch, git_commit_template,
                git_pr_provider, git_repo_owner, git_repo_name, git_api_username,
                jira_base_url, jira_project_key, jira_email,
                jira_status_filters, jira_assignee_filter,
                created_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                pid, input["name"], input["slug"],
                input.get("description"), 1 if input.get("enabled", True) else 0,
                input.get("frontendTheme"),
                defaults.get("projectRoot", ""),
                defaults.get("frontendUrl"), defaults.get("backendUrl"),
                defaults.get("dockerComposePath"), defaults.get("dockerPatchId"),
                git.get("remote") or "origin",
                git.get("productionBranch") or "production",
                git.get("stagingBranch") or "staging",
                git.get("prTargetBranch") or "staging",
                git.get("commitMessageTemplate") or "[{jiraKey}] {summary}",
                git.get("prProvider"), git.get("repoOwner"), git.get("repoName"),
                git.get("apiUsername"),
                jira.get("baseUrl"), jira.get("projectKey"), jira.get("email"),
                json.dumps(jira.get("statusFilters", ["To Do", "In Progress", "Unit Testing"])),
                jira.get("assigneeFilter"),
                ts, ts,
            ),
        )
        db.commit()
        return self.find_by_id(pid)

    def update(self, project_id: str, input: dict) -> dict | None:
        current = self.find_by_id(project_id)
        if not current:
            return None
        merged = dict(current)
        merged["name"] = input.get("name", current["name"])
        merged["slug"] = input.get("slug", current["slug"])
        if "description" in input:
            merged["description"] = input["description"]
        if "enabled" in input:
            merged["enabled"] = input["enabled"]
        if "frontendTheme" in input:
            merged["frontendTheme"] = input["frontendTheme"]
        if "defaults" in input and input["defaults"]:
            merged["defaults"] = {**current["defaults"], **input["defaults"]}
        if "git" in input and input["git"]:
            g = {**current["git"], **input["git"]}
            g.pop("apiToken", None)
            merged["git"] = g
        if "jira" in input and input["jira"]:
            j = {**current["jira"], **input["jira"]}
            j.pop("apiToken", None)  # never persist raw token in the main row
            merged["jira"] = j

        db = get_db()
        db.execute(
            """UPDATE projects SET
               name=?, slug=?, description=?, enabled=?, frontend_theme=?,
               default_project_root=?, default_frontend_url=?, default_backend_url=?,
               default_docker_compose=?, default_docker_patch_id=?,
               git_remote=?, git_production_branch=?, git_staging_branch=?,
               git_pr_target_branch=?, git_commit_template=?,
               git_pr_provider=?, git_repo_owner=?, git_repo_name=?, git_api_username=?,
               jira_base_url=?, jira_project_key=?, jira_email=?,
               jira_status_filters=?, jira_assignee_filter=?,
               updated_at=?
               WHERE id=?""",
            (
                merged["name"], merged["slug"], merged.get("description"),
                1 if merged["enabled"] else 0, merged.get("frontendTheme"),
                merged["defaults"]["projectRoot"], merged["defaults"].get("frontendUrl"),
                merged["defaults"].get("backendUrl"), merged["defaults"].get("dockerComposePath"),
                merged["defaults"].get("dockerPatchId"),
                merged["git"].get("remote") or "origin",
                merged["git"].get("productionBranch") or "production",
                merged["git"].get("stagingBranch") or "staging",
                merged["git"].get("prTargetBranch") or "staging",
                merged["git"].get("commitMessageTemplate") or "[{jiraKey}] {summary}",
                merged["git"].get("prProvider"), merged["git"].get("repoOwner"),
                merged["git"].get("repoName"), merged["git"].get("apiUsername"),
                merged["jira"].get("baseUrl"), merged["jira"].get("projectKey"),
                merged["jira"].get("email"),
                json.dumps(merged["jira"].get("statusFilters", [])),
                merged["jira"].get("assigneeFilter"),
                now_iso(), project_id,
            ),
        )
        db.commit()
        return self.find_by_id(project_id)

    def get_jira_token_enc(self, project_id: str) -> str | None:
        row = get_db().execute(
            "SELECT jira_api_token_enc FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
        return row["jira_api_token_enc"] if row else None

    def set_jira_token_enc(self, project_id: str, enc: str | None) -> None:
        db = get_db()
        db.execute(
            "UPDATE projects SET jira_api_token_enc=?, updated_at=? WHERE id=?",
            (enc, now_iso(), project_id),
        )
        db.commit()

    def has_jira_token(self, project_id: str) -> bool:
        return bool(self.get_jira_token_enc(project_id))

    def get_git_token_enc(self, project_id: str) -> str | None:
        row = get_db().execute(
            "SELECT git_api_token_enc FROM projects WHERE id = ?", (project_id,)
        ).fetchone()
        return row["git_api_token_enc"] if row else None

    def set_git_token_enc(self, project_id: str, enc: str | None) -> None:
        db = get_db()
        db.execute(
            "UPDATE projects SET git_api_token_enc=?, updated_at=? WHERE id=?",
            (enc, now_iso(), project_id),
        )
        db.commit()

    def has_git_token(self, project_id: str) -> bool:
        return bool(self.get_git_token_enc(project_id))

    def delete(self, project_id: str) -> bool:
        db = get_db()
        cur = db.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        db.commit()
        return cur.rowcount > 0


projects_repo = _ProjectsRepo()
