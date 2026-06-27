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

    def list_workflow_history(
        self,
        project_ids: list[str],
        *,
        project_id: str | None = None,
        user_id: str | None = None,
        approval_status: str | None = None,
        search: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[dict], int]:
        if not project_ids:
            return [], 0

        effective_ids = [project_id] if project_id else list(project_ids)
        if project_id and project_id not in project_ids:
            return [], 0

        placeholders = ",".join("?" * len(effective_ids))
        conditions = [f"r.project_id IN ({placeholders})", "r.mode = 'workflow'"]
        params: list = list(effective_ids)

        if user_id:
            conditions.append("r.user_id = ?")
            params.append(user_id)

        if approval_status:
            conditions.append("COALESCE(r.approval_status, 'draft') = ?")
            params.append(approval_status)

        if search:
            term = f"%{search.strip()}%"
            conditions.append(
                "(r.jira_key LIKE ? OR r.branch_name LIKE ? OR r.summary LIKE ?)"
            )
            params.extend([term, term, term])

        where = " AND ".join(conditions)
        db = get_db()

        count_row = db.execute(
            f"SELECT COUNT(*) AS n FROM runs r WHERE {where}",
            params,
        ).fetchone()
        total = count_row["n"] if count_row else 0

        offset = max(page - 1, 0) * page_size
        rows = db.execute(
            f"""SELECT r.*, u.username, u.display_name, p.name AS project_name
                FROM runs r
                JOIN users u ON u.id = r.user_id
                JOIN projects p ON p.id = r.project_id
                WHERE {where}
                ORDER BY r.updated_at DESC
                LIMIT ? OFFSET ?""",
            [*params, page_size, offset],
        ).fetchall()

        return [
            {
                **_map_row(r),
                "username": r["username"],
                "displayName": r["display_name"],
                "projectName": r["project_name"],
            }
            for r in rows
        ], total

    def list_distinct_history_users(self, project_ids: list[str]) -> list[dict]:
        if not project_ids:
            return []
        placeholders = ",".join("?" * len(project_ids))
        rows = get_db().execute(
            f"""SELECT DISTINCT u.id, u.username, u.display_name
                FROM runs r
                JOIN users u ON u.id = r.user_id
                WHERE r.project_id IN ({placeholders}) AND r.mode = 'workflow'
                ORDER BY u.display_name ASC, u.username ASC""",
            project_ids,
        ).fetchall()
        return [
            {
                "userId": r["id"],
                "username": r["username"],
                "displayName": r["display_name"],
            }
            for r in rows
        ]

    def find_latest_workflow_for_task(
        self, project_id: str, user_id: str, jira_key: str
    ) -> dict | None:
        row = get_db().execute(
            """SELECT * FROM runs
               WHERE project_id=? AND user_id=? AND jira_key=? AND mode='workflow'
               ORDER BY updated_at DESC LIMIT 1""",
            (project_id, user_id, jira_key),
        ).fetchone()
        return _map_row(row) if row else None

    def delete_by_id(self, run_id: str) -> bool:
        db = get_db()
        cur = db.execute("DELETE FROM runs WHERE id = ?", (run_id,))
        db.commit()
        return cur.rowcount > 0

    def delete_many(self, run_ids: list[str]) -> int:
        if not run_ids:
            return 0
        placeholders = ",".join("?" * len(run_ids))
        db = get_db()
        cur = db.execute(f"DELETE FROM runs WHERE id IN ({placeholders})", run_ids)
        db.commit()
        return cur.rowcount

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
