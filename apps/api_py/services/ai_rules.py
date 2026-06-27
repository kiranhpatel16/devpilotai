from services.prompt import (
    IMPLEMENTATION_QUALITY_RULES,
    MAGENTO_RULES,
    AGENT_OUTPUT_CONTRACT,
    DEFAULT_MAGENTO_RULES_TEMPLATE,
    REQUIREMENT_ANALYSIS_RULES,
)
from db.project_ai_rules import project_ai_rules_repo


def get_default_rules() -> dict:
    return {
        "implementationQualityRules": IMPLEMENTATION_QUALITY_RULES,
        "magentoRules": DEFAULT_MAGENTO_RULES_TEMPLATE,
        "planningRules": REQUIREMENT_ANALYSIS_RULES,
        "magentoRulesExpanded": MAGENTO_RULES,
        "agentOutputContract": AGENT_OUTPUT_CONTRACT,
    }


def get_editable_magento_template(stored: str | None) -> str:
    if stored:
        return stored
    return DEFAULT_MAGENTO_RULES_TEMPLATE


def _compose_magento_rules(magento_template: str, implementation_quality: str) -> str:
    if "{IMPLEMENTATION_QUALITY_RULES}" in magento_template:
        return magento_template.replace("{IMPLEMENTATION_QUALITY_RULES}", implementation_quality)
    return magento_template


def project_id_from_ctx(ctx: dict) -> str | None:
    pid = ctx.get("projectId")
    if pid:
        return str(pid)
    project = ctx.get("project")
    if isinstance(project, dict) and project.get("id"):
        return str(project["id"])
    return None


def attach_project_ai_rules(ctx: dict, project_id: str | None = None) -> dict:
    """Resolve admin AI rules for the project and attach to the run context."""
    pid = project_id or project_id_from_ctx(ctx)
    if pid:
        from services.ai_rule_templates import ensure_auto_template_for_project

        ensure_auto_template_for_project(str(pid))
    rules = resolve_effective_rules(pid)
    return {
        **ctx,
        "projectId": pid,
        "aiRules": rules,
        "usingCustomAiRules": bool(rules.get("hasCustomRules")),
    }


def resolve_effective_rules(project_id: str | None) -> dict:
    """Return effective prompt rule strings for a project (custom or system defaults)."""
    defaults = get_default_rules()
    if not project_id:
        return {
            "implementationQualityRules": defaults["implementationQualityRules"],
            "magentoRules": defaults["magentoRulesExpanded"],
            "planningRules": defaults["planningRules"],
            "agentOutputContract": defaults["agentOutputContract"],
            "hasCustomRules": False,
            "usingDefaults": True,
        }

    custom = project_ai_rules_repo.find_by_project_id(project_id)
    if not custom:
        return {
            "implementationQualityRules": defaults["implementationQualityRules"],
            "magentoRules": defaults["magentoRulesExpanded"],
            "planningRules": defaults["planningRules"],
            "agentOutputContract": defaults["agentOutputContract"],
            "hasCustomRules": False,
            "usingDefaults": True,
        }

    impl = custom.get("implementationQualityRules") or defaults["implementationQualityRules"]
    magento_raw = get_editable_magento_template(custom.get("magentoRules"))
    magento = _compose_magento_rules(magento_raw, impl)
    contract = custom.get("agentOutputContract") or defaults["agentOutputContract"]
    planning = custom.get("planningRules") or defaults["planningRules"]

    return {
        "implementationQualityRules": impl,
        "magentoRules": magento,
        "planningRules": planning,
        "agentOutputContract": contract,
        "hasCustomRules": True,
        "usingDefaults": False,
    }
