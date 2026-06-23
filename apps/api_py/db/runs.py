import uuid
from database import get_db, now_iso


def _map_row(row) -> dict:
    return {
        "id": row["id"],
        "projectId": row["project_id"],
        "userId": row["user_id"],
        "jiraKey": row["jira_key"],
        "mode": row["mode"],
        "provider": row["provider"],
        "model": row["model"],
        "status": row["status"],
        "branchName": row["branch_name"],
        "userInstructions": row["user_instructions"],
        "summary": row["summary"],
        "currentStep": row["current_step"] if "current_step" in row.keys() else None,
        "approvalStatus": row["approval_status"] if "approval_status" in row.keys() else None,
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


class _RunsRepo:
    def find_by_id(self, run_id: str) -> dict | None:
        row = get_db().execute("SELECT * FROM runs WHERE id=?", (run_id,)).fetchone()
        return _map_row(row) if row else None

    def list_for_user(self, user_id: str, limit: int = 50) -> list[dict]:
        rows = get_db().execute(
            "SELECT * FROM runs WHERE user_id=? ORDER BY created_at DESC LIMIT ?",
            (user_id, limit),
        ).fetchall()
        return [_map_row(r) for r in rows]

    def list_workflow_for_project(self, project_id: str, limit: int = 100) -> list[dict]:
        rows = get_db().execute(
            """SELECT * FROM runs
               WHERE project_id=? AND mode='workflow'
               ORDER BY updated_at DESC LIMIT ?""",
            (project_id, limit),
        ).fetchall()
        return [_map_row(r) for r in rows]

    def update_fields(self, run_id: str, fields: dict) -> dict | None:
        allowed = {
            "jiraKey": "jira_key",
            "provider": "provider",
            "model": "model",
            "status": "status",
            "branchName": "branch_name",
            "userInstructions": "user_instructions",
            "summary": "summary",
            "currentStep": "current_step",
            "approvalStatus": "approval_status",
        }
        sets = []
        values = []
        for key, col in allowed.items():
            if key in fields:
                sets.append(f"{col}=?")
                values.append(fields[key])
        if not sets:
            return self.find_by_id(run_id)
        sets.append("updated_at=?")
        values.append(now_iso())
        values.append(run_id)
        db = get_db()
        db.execute(f"UPDATE runs SET {', '.join(sets)} WHERE id=?", values)
        db.commit()
        return self.find_by_id(run_id)

    def create(self, input: dict) -> dict:
        rid = str(uuid.uuid4())
        ts = now_iso()
        db = get_db()
        db.execute(
            """INSERT INTO runs (
               id, project_id, user_id, jira_key, mode, provider, model,
               status, branch_name, user_instructions, created_at, updated_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                rid, input["projectId"], input["userId"],
                input.get("jiraKey"), input["mode"],
                input.get("provider"), input.get("model"),
                input.get("status", "selected"),
                input.get("branchName"), input.get("userInstructions"),
                ts, ts,
            ),
        )
        db.commit()
        return self.find_by_id(rid)

    def update_status(self, run_id: str, status: str, summary: str | None = None) -> dict | None:
        db = get_db()
        db.execute(
            "UPDATE runs SET status=?, summary=COALESCE(?, summary), updated_at=? WHERE id=?",
            (status, summary, now_iso(), run_id),
        )
        db.commit()
        return self.find_by_id(run_id)

    def get_detail_json(self, run_id: str) -> str | None:
        row = get_db().execute("SELECT detail_json FROM runs WHERE id=?", (run_id,)).fetchone()
        return row["detail_json"] if row else None

    def set_detail_json(self, run_id: str, json_str: str) -> None:
        db = get_db()
        db.execute("UPDATE runs SET detail_json=?, updated_at=? WHERE id=?", (json_str, now_iso(), run_id))
        db.commit()

    def set_error(self, run_id: str, error: str | None) -> None:
        db = get_db()
        db.execute("UPDATE runs SET error=?, updated_at=? WHERE id=?", (error, now_iso(), run_id))
        db.commit()

    def get_error(self, run_id: str) -> str | None:
        row = get_db().execute("SELECT error FROM runs WHERE id=?", (run_id,)).fetchone()
        return row["error"] if row else None


runs_repo = _RunsRepo()
