import json
import uuid
from database import get_db, now_iso


def _map_row(row) -> dict:
    try:
        models = json.loads(row["models_json"])
    except Exception:
        models = []
    return {
        "id": row["id"],
        "label": row["label"],
        "defaultBaseUrl": row["default_base_url"],
        "models": models if isinstance(models, list) else [],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


class _CustomAiProvidersRepo:
    def list_all(self) -> list[dict]:
        rows = get_db().execute(
            "SELECT * FROM custom_ai_providers ORDER BY label ASC"
        ).fetchall()
        return [_map_row(r) for r in rows]

    def find_by_id(self, provider_id: str) -> dict | None:
        row = get_db().execute(
            "SELECT * FROM custom_ai_providers WHERE id = ?", (provider_id,)
        ).fetchone()
        return _map_row(row) if row else None

    def create(self, input: dict) -> dict:
        pid = input["id"]
        ts = now_iso()
        models = input.get("models") or []
        db = get_db()
        db.execute(
            """INSERT INTO custom_ai_providers
               (id, label, default_base_url, models_json, created_at, updated_at)
               VALUES (?,?,?,?,?,?)""",
            (pid, input["label"], input.get("defaultBaseUrl") or "https://api.openai.com/v1",
             json.dumps(models), ts, ts),
        )
        db.commit()
        return self.find_by_id(pid)

    def delete(self, provider_id: str) -> bool:
        db = get_db()
        cur = db.execute("DELETE FROM custom_ai_providers WHERE id = ?", (provider_id,))
        db.commit()
        return cur.rowcount > 0


custom_ai_providers_repo = _CustomAiProvidersRepo()
