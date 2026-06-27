"""Tests for per-project AI rules resolution in prompts."""

from services.ai_rules import attach_project_ai_rules, resolve_effective_rules
from services.prompt import build_prompt, MAGENTO_RULES


def test_resolve_effective_rules_uses_custom_magento_rules(monkeypatch):
  custom_magento = "CUSTOM MAGENTO RULES FOR FABRIC PROJECT"
  custom_contract = "CUSTOM OUTPUT CONTRACT"
  custom_planning = "CUSTOM PLANNING RULES"

  def fake_find(project_id):
    if project_id == "proj-fabric":
      return {
        "implementationQualityRules": "CUSTOM QUALITY",
        "magentoRules": custom_magento,
        "planningRules": custom_planning,
        "agentOutputContract": custom_contract,
      }
    return None

  monkeypatch.setattr(
    "services.ai_rules.project_ai_rules_repo.find_by_project_id",
    fake_find,
  )

  rules = resolve_effective_rules("proj-fabric")
  assert rules["hasCustomRules"] is True
  assert custom_magento in rules["magentoRules"]
  assert rules["planningRules"] == custom_planning
  assert rules["agentOutputContract"] == custom_contract


def test_build_prompt_uses_attached_project_rules():
  custom_magento = "ENTERPRISE FABRIC MAGENTO PROMPT"
  ctx = attach_project_ai_rules(
    {
      "project": {"id": "proj-fabric", "name": "Fabric"},
      "cwd": "/var/www/html/fabric",
      "mode": "plan",
      "jira": None,
      "jiraKey": None,
      "userInstructions": None,
    },
    "proj-fabric",
  )
  ctx["aiRules"] = {
    "magentoRules": custom_magento,
    "agentOutputContract": "CUSTOM CONTRACT",
    "hasCustomRules": True,
  }

  prompt = build_prompt(ctx)
  assert custom_magento in prompt["system"]
  assert "CUSTOM CONTRACT" not in prompt["system"]  # plan mode omits contract


def test_build_prompt_agent_mode_includes_custom_contract():
  custom_magento = "FABRIC AGENT RULES"
  custom_contract = "FABRIC JSON CONTRACT"
  ctx = {
    "projectId": "proj-fabric",
    "project": {"id": "proj-fabric", "name": "Fabric"},
    "cwd": "/var/www/html/fabric",
    "mode": "agent",
    "jira": None,
    "jiraKey": None,
    "userInstructions": None,
    "aiRules": {
      "magentoRules": custom_magento,
      "agentOutputContract": custom_contract,
      "hasCustomRules": True,
    },
  }

  prompt = build_prompt(ctx)
  assert custom_magento in prompt["system"]
  assert custom_contract in prompt["system"]


def test_build_prompt_requirement_analysis_uses_project_planning_rules():
  ctx = {
    "projectId": "proj-fabric",
    "project": {"id": "proj-fabric", "name": "Fabric"},
    "cwd": "/var/www/html/fabric",
    "mode": "requirement_analysis",
    "jira": {
      "key": "FM-1",
      "summary": "Add information section to Contact Us page",
      "description": "Brief about us, contact info, business hours, social links.",
    },
    "jiraKey": "FM-1",
    "userInstructions": None,
    "repoOverview": "Frontend themes: Commercepundit/fabric5anddime",
    "fileExcerpts": [],
    "knowledgeChunks": [],
    "aiRules": {
      "magentoRules": "FABRIC CODING RULES",
      "planningRules": "FABRIC PLANNING: stay scoped to ticket only.",
      "agentOutputContract": "CONTRACT",
      "hasCustomRules": True,
    },
  }
  prompt = build_prompt(ctx)
  assert prompt["jsonMode"] is True
  assert "FABRIC PLANNING" in prompt["system"]
  assert "FABRIC CODING RULES" not in prompt["system"]
  assert "functionalRequirements" in prompt["system"]


def test_build_prompt_architecture_uses_file_structure_not_diagram():
  ctx = {
    "projectId": None,
    "project": {"id": None, "name": "Fabric"},
    "cwd": "/var/www/html/fabric",
    "mode": "architecture_design",
    "jira": {"key": "FM-2", "summary": "Cron cleanup module"},
    "jiraKey": "FM-2",
    "fileExcerpts": [],
    "knowledgeChunks": [],
    "requirementAnalysis": {"summary": "Add cron cleanup module"},
    "aiRules": {
      "magentoRules": "MAGENTO",
      "planningRules": "PLAN",
      "agentOutputContract": "CONTRACT",
    },
  }
  prompt = build_prompt(ctx)
  assert prompt["jsonMode"] is True
  assert "moduleFileStructure" in prompt["system"]
  assert "componentDiagram" not in prompt["system"]
  assert "directory tree" in prompt["user"].lower() or "file structure" in prompt["user"].lower()


def test_fabric_hyva_template_has_placeholder():
  from services.ai_rule_templates import get_fabric_hyva_template

  rules = get_fabric_hyva_template()
  assert "{IMPLEMENTATION_QUALITY_RULES}" in rules["magentoRules"]
  assert "fabric5anddime" in rules["magentoRules"]
  assert "Commercepundit" in rules["agentOutputContract"]
  assert rules["planningRules"]


def test_build_prompt_defaults_without_custom_rules():
  ctx = {
    "projectId": None,
    "project": {"id": None, "name": "Test"},
    "cwd": "/tmp",
    "mode": "agent",
    "jira": None,
    "jiraKey": None,
    "userInstructions": None,
  }
  prompt = build_prompt(ctx)
  assert MAGENTO_RULES.splitlines()[0] in prompt["system"]
