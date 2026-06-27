import sqlite3
import pathlib
import threading
from config import DATABASE_FILE

_local = threading.local()

SCHEMA_SQL = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id                      TEXT PRIMARY KEY,
  username                TEXT NOT NULL UNIQUE,
  email                   TEXT,
  display_name            TEXT NOT NULL,
  password_hash           TEXT NOT NULL,
  global_role             TEXT NOT NULL DEFAULT 'developer',
  status                  TEXT NOT NULL DEFAULT 'active',
  must_change_password    INTEGER NOT NULL DEFAULT 0,
  failed_login_attempts   INTEGER NOT NULL DEFAULT 0,
  locked_until            TEXT,
  last_login_at           TEXT,
  jira_account_id         TEXT,
  created_at              TEXT NOT NULL,
  updated_at              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id                       TEXT PRIMARY KEY,
  name                     TEXT NOT NULL,
  slug                     TEXT NOT NULL UNIQUE,
  description              TEXT,
  enabled                  INTEGER NOT NULL DEFAULT 1,
  frontend_theme           TEXT,
  default_project_root     TEXT NOT NULL DEFAULT '',
  default_frontend_url     TEXT,
  default_backend_url      TEXT,
  default_docker_compose   TEXT,
  default_docker_patch_id  TEXT,
  git_remote               TEXT NOT NULL DEFAULT 'origin',
  git_production_branch    TEXT NOT NULL DEFAULT 'production',
  git_staging_branch       TEXT NOT NULL DEFAULT 'staging',
  git_pr_target_branch     TEXT NOT NULL DEFAULT 'staging',
  git_commit_template      TEXT NOT NULL DEFAULT '[{jiraKey}] {summary}',
  jira_base_url            TEXT,
  jira_project_key         TEXT,
  jira_email               TEXT,
  jira_api_token_enc       TEXT,
  jira_status_filters      TEXT NOT NULL DEFAULT '["To Do","In Progress","Unit Testing"]',
  jira_assignee_filter     TEXT,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_project_roles (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  project_role  TEXT NOT NULL DEFAULT 'developer',
  assigned_by   TEXT,
  assigned_at   TEXT NOT NULL,
  UNIQUE(user_id, project_id)
);

CREATE TABLE IF NOT EXISTS user_project_environments (
  id                    TEXT PRIMARY KEY,
  user_id               TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id            TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  project_root          TEXT NOT NULL,
  frontend_url          TEXT,
  backend_url           TEXT,
  database_host         TEXT,
  database_port         INTEGER,
  database_name         TEXT,
  database_user         TEXT,
  database_password_enc TEXT,
  docker_compose_path   TEXT,
  php_bin               TEXT,
  path_verified_at      TEXT,
  last_health_json      TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  UNIQUE(user_id, project_id)
);

CREATE TABLE IF NOT EXISTS runs (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jira_key          TEXT,
  mode              TEXT NOT NULL,
  provider          TEXT,
  model             TEXT,
  status            TEXT NOT NULL DEFAULT 'selected',
  branch_name       TEXT,
  user_instructions TEXT,
  summary           TEXT,
  detail_json       TEXT,
  error             TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activities (
  id            TEXT PRIMARY KEY,
  user_id       TEXT,
  username      TEXT,
  action        TEXT NOT NULL,
  resource_type TEXT,
  resource_id   TEXT,
  project_id    TEXT,
  project_name  TEXT,
  jira_key      TEXT,
  summary       TEXT NOT NULL,
  metadata_json TEXT,
  ip_address    TEXT,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_provider_settings (
  provider_id   TEXT PRIMARY KEY,
  enabled       INTEGER NOT NULL DEFAULT 0,
  api_key_enc   TEXT,
  base_url      TEXT,
  default_model TEXT,
  extra_json    TEXT,
  updated_by    TEXT,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS run_ai_usage (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  provider_id   TEXT NOT NULL,
  model         TEXT NOT NULL,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  latency_ms    INTEGER,
  created_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activities_created_at ON activities(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_project ON runs(project_id);
CREATE INDEX IF NOT EXISTS idx_runs_user ON runs(user_id);
CREATE INDEX IF NOT EXISTS idx_upr_user ON user_project_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_upe_user ON user_project_environments(user_id);

CREATE TABLE IF NOT EXISTS custom_ai_providers (
  id                TEXT PRIMARY KEY,
  label             TEXT NOT NULL,
  default_base_url  TEXT NOT NULL DEFAULT 'https://api.openai.com/v1',
  models_json       TEXT NOT NULL DEFAULT '[]',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_ai_rules (
  id                            TEXT PRIMARY KEY,
  project_id                    TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  implementation_quality_rules  TEXT,
  magento_rules                 TEXT,
  agent_output_contract         TEXT,
  created_at                    TEXT NOT NULL,
  updated_at                    TEXT NOT NULL
);
"""


def get_db() -> sqlite3.Connection:
    if not hasattr(_local, "conn") or _local.conn is None:
        db_path = pathlib.Path(DATABASE_FILE)
        db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(db_path), check_same_thread=False, timeout=15)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 10000")
        _migrate(conn)
        _local.conn = conn
    return _local.conn


def _migrate(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA_SQL)
    cols = {row[1] for row in conn.execute("PRAGMA table_info(runs)")}
    if "current_step" not in cols:
        conn.execute("ALTER TABLE runs ADD COLUMN current_step TEXT")
    if "approval_status" not in cols:
        conn.execute("ALTER TABLE runs ADD COLUMN approval_status TEXT DEFAULT 'draft'")
    proj_cols = {row[1] for row in conn.execute("PRAGMA table_info(projects)")}
    if "git_pr_provider" not in proj_cols:
        conn.execute("ALTER TABLE projects ADD COLUMN git_pr_provider TEXT")
    if "git_repo_owner" not in proj_cols:
        conn.execute("ALTER TABLE projects ADD COLUMN git_repo_owner TEXT")
    if "git_repo_name" not in proj_cols:
        conn.execute("ALTER TABLE projects ADD COLUMN git_repo_name TEXT")
    if "git_api_username" not in proj_cols:
        conn.execute("ALTER TABLE projects ADD COLUMN git_api_username TEXT")
    if "git_api_token_enc" not in proj_cols:
        conn.execute("ALTER TABLE projects ADD COLUMN git_api_token_enc TEXT")
    if "deploy_profile" not in proj_cols:
        conn.execute("ALTER TABLE projects ADD COLUMN deploy_profile TEXT NOT NULL DEFAULT 'auto'")
    if "deploy_skip_composer" not in proj_cols:
        conn.execute(
            "ALTER TABLE projects ADD COLUMN deploy_skip_composer INTEGER NOT NULL DEFAULT 0"
        )
    if "llm_config_json" not in proj_cols:
        conn.execute("ALTER TABLE projects ADD COLUMN llm_config_json TEXT")
    conn.commit()


def now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()
