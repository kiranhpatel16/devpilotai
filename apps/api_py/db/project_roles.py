import uuid
from database import get_db, now_iso


class _ProjectRolesRepo:
    def list_for_user(self, user_id: str) -> list[dict]:
        rows = get_db().execute(
            """SELECT upr.project_id, upr.project_role, p.name, p.slug
               FROM user_project_roles upr
               JOIN projects p ON p.id = upr.project_id
               WHERE upr.user_id = ?
               ORDER BY p.name ASC""",
            (user_id,),
        ).fetchall()
        return [
            {
                "projectId": r["project_id"],
                "projectName": r["name"],
                "projectSlug": r["slug"],
                "role": r["project_role"],
            }
            for r in rows
        ]

    def get_role(self, user_id: str, project_id: str) -> str | None:
        row = get_db().execute(
            "SELECT project_role FROM user_project_roles WHERE user_id=? AND project_id=?",
            (user_id, project_id),
        ).fetchone()
        return row["project_role"] if row else None

    def count_users_for_project(self, project_id: str) -> int:
        r = get_db().execute(
            "SELECT COUNT(*) AS n FROM user_project_roles WHERE project_id=?", (project_id,)
        ).fetchone()
        return r["n"]

    def set_for_user(self, user_id: str, assignments: list[dict], assigned_by: str | None) -> None:
        db = get_db()
        db.execute("DELETE FROM user_project_roles WHERE user_id=?", (user_id,))
        for a in assignments:
            db.execute(
                """INSERT INTO user_project_roles
                   (id, user_id, project_id, project_role, assigned_by, assigned_at)
                   VALUES (?,?,?,?,?,?)""",
                (str(uuid.uuid4()), user_id, a["projectId"], a["role"], assigned_by, now_iso()),
            )
        db.commit()


project_roles_repo = _ProjectRolesRepo()
