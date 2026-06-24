import uuid
import json
from database import get_db, now_iso


def _map_row(row) -> dict:
    metadata = None
    if row["metadata_json"]:
        try:
            metadata = json.loads(row["metadata_json"])
        except Exception:
            metadata = None
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "username": row["username"],
        "action": row["action"],
        "resourceType": row["resource_type"],
        "resourceId": row["resource_id"],
        "projectId": row["project_id"],
        "projectName": row["project_name"],
        "jiraKey": row["jira_key"],
        "summary": row["summary"],
        "metadata": metadata,
        "ipAddress": row["ip_address"],
        "createdAt": row["created_at"],
    }


class _ActivitiesRepo:
    def create(self, input: dict) -> dict:
        aid = str(uuid.uuid4())
        ts = now_iso()
        db = get_db()
        db.execute(
            """INSERT INTO activities (
               id, user_id, username, action, resource_type, resource_id,
               project_id, project_name, jira_key, summary, metadata_json,
               ip_address, created_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                aid, input.get("userId"), input.get("username"),
                input["action"], input.get("resourceType"), input.get("resourceId"),
                input.get("projectId"), input.get("projectName"), input.get("jiraKey"),
                input["summary"],
                json.dumps(input["metadata"]) if input.get("metadata") else None,
                input.get("ipAddress"), ts,
            ),
        )
        db.commit()
        row = db.execute("SELECT * FROM activities WHERE id=?", (aid,)).fetchone()
        return _map_row(row)

    def recent(self, limit: int = 5) -> list[dict]:
        rows = get_db().execute(
            "SELECT * FROM activities ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [_map_row(r) for r in rows]

    def list_for_user(self, user_id: str, limit: int = 20) -> list[dict]:
        rows = get_db().execute(
            """SELECT * FROM activities
               WHERE user_id = ? OR user_id IS NULL
               ORDER BY created_at DESC LIMIT ?""",
            (user_id, limit),
        ).fetchall()
        return [_map_row(r) for r in rows]

    def list_for_run(self, run_id: str, limit: int = 30) -> list[dict]:
        rows = get_db().execute(
            """SELECT * FROM activities
               WHERE resource_type = 'run' AND resource_id = ?
               ORDER BY created_at DESC LIMIT ?""",
            (run_id, limit),
        ).fetchall()
        return [_map_row(r) for r in rows]

    def list_for_projects(self, project_ids: list[str], limit: int = 20) -> list[dict]:
        if not project_ids:
            return []
        placeholders = ",".join("?" * len(project_ids))
        rows = get_db().execute(
            f"""SELECT * FROM activities
                WHERE project_id IN ({placeholders})
                ORDER BY created_at DESC LIMIT ?""",
            (*project_ids, limit),
        ).fetchall()
        return [_map_row(r) for r in rows]


activities_repo = _ActivitiesRepo()
