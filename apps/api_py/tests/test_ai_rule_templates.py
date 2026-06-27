"""Tests for auto-applied AI rule templates."""

import uuid

from db.project_ai_rules import project_ai_rules_repo
from db.projects import projects_repo
from services.ai_rule_templates import (
    ensure_auto_template_for_project,
    get_fabric_hyva_template,
    project_qualifies_for_fabric_auto_template,
    seed_all_auto_templates,
)


def _create_project(slug: str, name: str) -> dict:
    return projects_repo.create({
        "name": name,
        "slug": slug,
        "description": "test",
        "enabled": True,
    })


def test_project_qualifies_for_fabric_by_slug_or_name():
    assert project_qualifies_for_fabric_auto_template({"slug": "fabric", "name": "Other"})
    assert project_qualifies_for_fabric_auto_template({"slug": "other", "name": "Fabric"})
    assert not project_qualifies_for_fabric_auto_template({"slug": "demo", "name": "Demo"})


def test_ensure_auto_template_persists_once(monkeypatch):
    project = _create_project(f"qa-{uuid.uuid4().hex[:8]}", "Fabric")
    try:
        assert ensure_auto_template_for_project(project["id"]) == "fabric-hyva"
        stored = project_ai_rules_repo.find_by_project_id(project["id"])
        assert stored is not None
        assert "fabric5anddime" in (stored.get("magentoRules") or "")
        assert ensure_auto_template_for_project(project["id"]) is None
    finally:
        project_ai_rules_repo.delete(project["id"])


def test_seed_all_auto_templates_skips_projects_with_custom_rules(monkeypatch):
    project = _create_project(f"fabric-seed-{uuid.uuid4().hex[:8]}", "Fabric")
    try:
        applied = seed_all_auto_templates()
        assert any(row["projectId"] == project["id"] for row in applied) or project_ai_rules_repo.has_custom_rules(project["id"])

        custom = get_fabric_hyva_template()
        custom["planningRules"] = "CUSTOM PLANNING ONLY"
        project_ai_rules_repo.upsert(project["id"], custom)

        applied_again = seed_all_auto_templates()
        assert not any(row["projectId"] == project["id"] for row in applied_again)
        assert project_ai_rules_repo.find_by_project_id(project["id"])["planningRules"] == "CUSTOM PLANNING ONLY"
    finally:
        project_ai_rules_repo.delete(project["id"])
