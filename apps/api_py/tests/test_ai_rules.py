"""Tests for per-project AI rules resolution in prompts."""

from services.ai_rules import attach_project_ai_rules, resolve_effective_rules
from services.prompt import build_prompt, MAGENTO_RULES


def test_resolve_effective_rules_uses_custom_magento_rules(monkeypatch):
  custom_magento = "CUSTOM MAGENTO RULES FOR FABRIC PROJECT"
  custom_contract = "CUSTOM OUTPUT CONTRACT"

  def fake_find(project_id):
    if project_id == "proj-fabric":
      return {
        "implementationQualityRules": "CUSTOM QUALITY",
        "magentoRules": custom_magento,
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
