import uuid
import json
from database import get_db, now_iso


class _KnowledgeRepo:
    def list_documents(self, project_id: str | None = None, category: str | None = None) -> list[dict]:
        q = "SELECT * FROM knowledge_documents WHERE 1=1"
        params: list = []
        if project_id:
            q += " AND project_id=?"
            params.append(project_id)
        if category:
            q += " AND category=?"
            params.append(category)
        q += " ORDER BY updated_at DESC"
        rows = get_db().execute(q, params).fetchall()
        return [self._map(r) for r in rows]

    def get(self, doc_id: str) -> dict | None:
        row = get_db().execute("SELECT * FROM knowledge_documents WHERE id=?", (doc_id,)).fetchone()
        return self._map(row) if row else None

    def create(self, fields: dict) -> dict:
        doc_id = str(uuid.uuid4())
        ts = now_iso()
        db = get_db()
        db.execute(
            """INSERT INTO knowledge_documents
               (id, project_id, category, title, content, tags_json, created_by, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                doc_id, fields["projectId"], fields["category"], fields["title"],
                fields.get("content", ""), json.dumps(fields.get("tags") or []),
                fields.get("createdBy"), ts, ts,
            ),
        )
        db.commit()
        return self.get(doc_id)

    def search(self, project_id: str, query: str, limit: int = 5) -> list[dict]:
        like = f"%{query}%"
        rows = get_db().execute(
            """SELECT * FROM knowledge_documents
               WHERE project_id=? AND (title LIKE ? OR content LIKE ?)
               ORDER BY updated_at DESC LIMIT ?""",
            (project_id, like, like, limit),
        ).fetchall()
        return [self._map(r) for r in rows]

    def _map(self, row) -> dict:
        tags = []
        if row["tags_json"]:
            try:
                tags = json.loads(row["tags_json"])
            except Exception:
                tags = []
        return {
            "id": row["id"],
            "projectId": row["project_id"],
            "category": row["category"],
            "title": row["title"],
            "content": row["content"],
            "tags": tags,
            "createdBy": row["created_by"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }


class _ProjectMemoryRepo:
    def list_for_project(self, project_id: str) -> list[dict]:
        rows = get_db().execute(
            "SELECT * FROM project_memory WHERE project_id=? ORDER BY mem_key",
            (project_id,),
        ).fetchall()
        return [{"id": r["id"], "projectId": r["project_id"], "key": r["mem_key"], "value": r["mem_value"]} for r in rows]

    def get_context(self, project_id: str) -> str:
        items = self.list_for_project(project_id)
        if not items:
            return ""
        lines = ["Project memory:"]
        for item in items:
            lines.append(f"- {item['key']}: {item['value']}")
        return "\n".join(lines)


knowledge_repo = _KnowledgeRepo()
project_memory_repo = _ProjectMemoryRepo()
