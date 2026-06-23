import uuid
import json
from database import get_db, now_iso


def _map_row(row) -> dict:
    extra = {}
    if row["extra_json"]:
        try:
            extra = json.loads(row["extra_json"])
        except Exception:
            extra = {}
    return {
        "providerId": row["provider_id"],
        "enabled": bool(row["enabled"]),
        "apiKeyEnc": row["api_key_enc"],
        "baseUrl": row["base_url"],
        "defaultModel": row["default_model"],
        "extra": extra,
    }


class _AiSettingsRepo:
    def get(self, provider_id: str) -> dict | None:
        row = get_db().execute(
            "SELECT * FROM ai_provider_settings WHERE provider_id=?", (provider_id,)
        ).fetchone()
        return _map_row(row) if row else None

    def list_all(self) -> list[dict]:
        rows = get_db().execute("SELECT * FROM ai_provider_settings").fetchall()
        return [_map_row(r) for r in rows]

    def upsert(self, provider_id: str, fields: dict, updated_by: str | None) -> dict:
        existing = self.get(provider_id)
        merged = {
            "enabled": fields.get("enabled", existing["enabled"] if existing else False),
            "apiKeyEnc": fields["apiKeyEnc"] if "apiKeyEnc" in fields else (existing["apiKeyEnc"] if existing else None),
            "baseUrl": fields["baseUrl"] if "baseUrl" in fields else (existing["baseUrl"] if existing else None),
            "defaultModel": fields["defaultModel"] if "defaultModel" in fields else (existing["defaultModel"] if existing else None),
            "extra": fields.get("extra", existing["extra"] if existing else {}),
        }
        db = get_db()
        db.execute(
            """INSERT INTO ai_provider_settings
               (provider_id, enabled, api_key_enc, base_url, default_model, extra_json, updated_by, updated_at)
               VALUES (?,?,?,?,?,?,?,?)
               ON CONFLICT(provider_id) DO UPDATE SET
                 enabled=excluded.enabled,
                 api_key_enc=excluded.api_key_enc,
                 base_url=excluded.base_url,
                 default_model=excluded.default_model,
                 extra_json=excluded.extra_json,
                 updated_by=excluded.updated_by,
                 updated_at=excluded.updated_at""",
            (
                provider_id, 1 if merged["enabled"] else 0,
                merged["apiKeyEnc"], merged["baseUrl"], merged["defaultModel"],
                json.dumps(merged["extra"]), updated_by, now_iso(),
            ),
        )
        db.commit()
        return self.get(provider_id)

    def delete(self, provider_id: str) -> bool:
        db = get_db()
        cur = db.execute("DELETE FROM ai_provider_settings WHERE provider_id = ?", (provider_id,))
        db.commit()
        return cur.rowcount > 0


class _RunUsageRepo:
    def record(self, run_id: str, usage: dict) -> None:
        db = get_db()
        db.execute(
            """INSERT INTO run_ai_usage
               (id, run_id, provider_id, model, input_tokens, output_tokens, latency_ms, created_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            (
                str(uuid.uuid4()), run_id, usage["provider"], usage["model"],
                usage.get("inputTokens"), usage.get("outputTokens"),
                usage.get("latencyMs"), now_iso(),
            ),
        )
        db.commit()


ai_settings_repo = _AiSettingsRepo()
run_usage_repo = _RunUsageRepo()
