import uuid
import json
from database import get_db, now_iso


def _map_row(row) -> dict:
    last_health = None
    if row["last_health_json"]:
        try:
            last_health = json.loads(row["last_health_json"])
        except Exception:
            last_health = None
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "projectId": row["project_id"],
        "projectRoot": row["project_root"],
        "frontendUrl": row["frontend_url"],
        "backendUrl": row["backend_url"],
        "databaseHost": row["database_host"],
        "databasePort": row["database_port"],
        "databaseName": row["database_name"],
        "databaseUser": row["database_user"],
        "dockerComposePath": row["docker_compose_path"],
        "phpBin": row["php_bin"],
        "pathVerifiedAt": row["path_verified_at"],
        "lastHealth": last_health,
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


class _EnvironmentsRepo:
    def find(self, user_id: str, project_id: str) -> dict | None:
        row = get_db().execute(
            "SELECT * FROM user_project_environments WHERE user_id=? AND project_id=?",
            (user_id, project_id),
        ).fetchone()
        return _map_row(row) if row else None

    def has_database_password(self, user_id: str, project_id: str) -> bool:
        row = get_db().execute(
            "SELECT database_password_enc FROM user_project_environments WHERE user_id=? AND project_id=?",
            (user_id, project_id),
        ).fetchone()
        return bool(row and row["database_password_enc"])

    def get_database_password(self, user_id: str, project_id: str) -> str | None:
        row = get_db().execute(
            "SELECT database_password_enc FROM user_project_environments WHERE user_id=? AND project_id=?",
            (user_id, project_id),
        ).fetchone()
        if not row or not row["database_password_enc"]:
            return None
        from lib.crypto import decrypt_secret
        return decrypt_secret(row["database_password_enc"])

    def list_for_project(self, project_id: str) -> list[dict]:
        rows = get_db().execute(
            "SELECT * FROM user_project_environments WHERE project_id=?", (project_id,)
        ).fetchall()
        return [_map_row(r) for r in rows]

    def upsert(self, user_id: str, project_id: str, input: dict) -> dict:
        existing = self.find(user_id, project_id)
        ts = now_iso()
        db = get_db()
        if existing:
            db.execute(
                """UPDATE user_project_environments SET
                   project_root=?, frontend_url=?, backend_url=?,
                   database_host=?, database_port=?, database_name=?, database_user=?,
                   database_password_enc=COALESCE(?, database_password_enc),
                   docker_compose_path=?, php_bin=?, updated_at=?
                   WHERE user_id=? AND project_id=?""",
                (
                    input["projectRoot"], input.get("frontendUrl"),
                    input.get("backendUrl"), input.get("databaseHost"),
                    input.get("databasePort"), input.get("databaseName"),
                    input.get("databaseUser"), input.get("databasePasswordEnc"),
                    input.get("dockerComposePath"), input.get("phpBin"),
                    ts, user_id, project_id,
                ),
            )
        else:
            eid = str(uuid.uuid4())
            db.execute(
                """INSERT INTO user_project_environments (
                   id, user_id, project_id, project_root, frontend_url, backend_url,
                   database_host, database_port, database_name, database_user,
                   database_password_enc, docker_compose_path, php_bin,
                   created_at, updated_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    eid, user_id, project_id, input["projectRoot"],
                    input.get("frontendUrl"), input.get("backendUrl"),
                    input.get("databaseHost"), input.get("databasePort"),
                    input.get("databaseName"), input.get("databaseUser"),
                    input.get("databasePasswordEnc"), input.get("dockerComposePath"),
                    input.get("phpBin"), ts, ts,
                ),
            )
        db.commit()
        return self.find(user_id, project_id)

    def save_health(self, user_id: str, project_id: str, health: dict) -> None:
        db = get_db()
        db.execute(
            """UPDATE user_project_environments
               SET last_health_json=?, path_verified_at=?, updated_at=?
               WHERE user_id=? AND project_id=?""",
            (
                json.dumps(health),
                health["checkedAt"] if health.get("ok") else None,
                now_iso(), user_id, project_id,
            ),
        )
        db.commit()


environments_repo = _EnvironmentsRepo()
