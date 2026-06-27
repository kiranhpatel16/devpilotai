import uuid
from database import get_db, now_iso


def _map_row(row) -> dict:
    return {
        "id": row["id"],
        "projectId": row["project_id"],
        "implementationQualityRules": row["implementation_quality_rules"],
        "magentoRules": row["magento_rules"],
        "planningRules": row["planning_rules"] if "planning_rules" in row.keys() else None,
        "agentOutputContract": row["agent_output_contract"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


class _ProjectAiRulesRepo:
    def find_by_project_id(self, project_id: str) -> dict | None:
        row = get_db().execute(
            "SELECT * FROM project_ai_rules WHERE project_id = ?", (project_id,)
        ).fetchone()
        return _map_row(row) if row else None

    def has_custom_rules(self, project_id: str) -> bool:
        return self.find_by_project_id(project_id) is not None

    def list_all(self) -> list[dict]:
        rows = get_db().execute(
            """SELECT r.*, p.name AS project_name, p.slug AS project_slug
               FROM project_ai_rules r
               JOIN projects p ON p.id = r.project_id
               ORDER BY p.name ASC"""
        ).fetchall()
        return [{
            **_map_row(r),
            "projectName": r["project_name"],
            "projectSlug": r["project_slug"],
        } for r in rows]

    def upsert(self, project_id: str, input: dict) -> dict:
        existing = self.find_by_project_id(project_id)
        ts = now_iso()
        db = get_db()
        if existing:
            db.execute(
                """UPDATE project_ai_rules SET
                   implementation_quality_rules=?,
                   magento_rules=?,
                   planning_rules=?,
                   agent_output_contract=?,
                   updated_at=?
                   WHERE project_id=?""",
                (
                    input.get("implementationQualityRules"),
                    input.get("magentoRules"),
                    input.get("planningRules"),
                    input.get("agentOutputContract"),
                    ts,
                    project_id,
                ),
            )
        else:
            rid = str(uuid.uuid4())
            db.execute(
                """INSERT INTO project_ai_rules (
                   id, project_id, implementation_quality_rules,
                   magento_rules, planning_rules, agent_output_contract, created_at, updated_at
                ) VALUES (?,?,?,?,?,?,?,?)""",
                (
                    rid,
                    project_id,
                    input.get("implementationQualityRules"),
                    input.get("magentoRules"),
                    input.get("planningRules"),
                    input.get("agentOutputContract"),
                    ts,
                    ts,
                ),
            )
        db.commit()
        return self.find_by_project_id(project_id)

    def delete(self, project_id: str) -> bool:
        db = get_db()
        cur = db.execute(
            "DELETE FROM project_ai_rules WHERE project_id = ?", (project_id,)
        )
        db.commit()
        return cur.rowcount > 0


project_ai_rules_repo = _ProjectAiRulesRepo()
