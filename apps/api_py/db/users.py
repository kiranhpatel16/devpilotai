import uuid
from database import get_db, now_iso


def _map_row(row) -> dict:
    return {
        "id": row["id"],
        "username": row["username"],
        "email": row["email"],
        "displayName": row["display_name"],
        "globalRole": row["global_role"],
        "status": row["status"],
        "mustChangePassword": bool(row["must_change_password"]),
        "jiraAccountId": row["jira_account_id"],
        "lastLoginAt": row["last_login_at"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "passwordHash": row["password_hash"],
        "failedLoginAttempts": row["failed_login_attempts"],
        "lockedUntil": row["locked_until"],
    }


def to_public_user(user: dict) -> dict:
    return {k: v for k, v in user.items() if k not in ("passwordHash", "failedLoginAttempts", "lockedUntil")}


class _UsersRepo:
    def find_by_id(self, user_id: str) -> dict | None:
        row = get_db().execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return _map_row(row) if row else None

    def find_by_username(self, username: str) -> dict | None:
        row = get_db().execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        return _map_row(row) if row else None

    def list_all(self) -> list[dict]:
        rows = get_db().execute("SELECT * FROM users ORDER BY created_at ASC").fetchall()
        return [to_public_user(_map_row(r)) for r in rows]

    def count_by_role(self, role: str) -> int:
        r = get_db().execute("SELECT COUNT(*) AS n FROM users WHERE global_role = ?", (role,)).fetchone()
        return r["n"]

    def create(self, username: str, display_name: str, password_hash: str,
               global_role: str, email: str | None = None,
               status: str = "active", must_change_password: bool = False) -> dict:
        uid = str(uuid.uuid4())
        ts = now_iso()
        db = get_db()
        db.execute(
            """INSERT INTO users
               (id, username, email, display_name, password_hash, global_role,
                status, must_change_password, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (uid, username, email, display_name, password_hash, global_role,
             status, 1 if must_change_password else 0, ts, ts),
        )
        db.commit()
        return self.find_by_id(uid)

    def update(self, user_id: str, fields: dict) -> dict | None:
        current = self.find_by_id(user_id)
        if not current:
            return None
        db = get_db()
        db.execute(
            """UPDATE users SET
               email=?, display_name=?, global_role=?, status=?,
               password_hash=?, must_change_password=?, updated_at=?
               WHERE id=?""",
            (
                fields.get("email", current["email"]),
                fields.get("displayName", current["displayName"]),
                fields.get("globalRole", current["globalRole"]),
                fields.get("status", current["status"]),
                fields.get("passwordHash", current["passwordHash"]),
                1 if fields.get("mustChangePassword", current["mustChangePassword"]) else 0,
                now_iso(),
                user_id,
            ),
        )
        db.commit()
        return self.find_by_id(user_id)

    def set_jira_account_id(self, user_id: str, jira_account_id: str | None) -> dict | None:
        db = get_db()
        db.execute(
            "UPDATE users SET jira_account_id=?, updated_at=? WHERE id=?",
            (jira_account_id, now_iso(), user_id),
        )
        db.commit()
        return self.find_by_id(user_id)

    def record_login_success(self, user_id: str) -> None:
        db = get_db()
        ts = now_iso()
        db.execute(
            "UPDATE users SET last_login_at=?, failed_login_attempts=0, locked_until=NULL, updated_at=? WHERE id=?",
            (ts, ts, user_id),
        )
        db.commit()

    def record_login_failure(self, user_id: str, attempts: int, locked_until: str | None) -> None:
        db = get_db()
        db.execute(
            "UPDATE users SET failed_login_attempts=?, locked_until=?, updated_at=? WHERE id=?",
            (attempts, locked_until, now_iso(), user_id),
        )
        db.commit()

    def delete(self, user_id: str) -> bool:
        db = get_db()
        cur = db.execute("DELETE FROM users WHERE id = ?", (user_id,))
        db.commit()
        return cur.rowcount > 0


users_repo = _UsersRepo()
