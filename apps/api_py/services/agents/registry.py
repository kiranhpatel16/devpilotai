"""Agent registry and definitions."""

AGENT_REGISTRY = {
    "planner": {
        "id": "planner",
        "label": "Planner Agent",
        "steps": [
            "select",
            "requirement_analysis",
            "architecture_design",
            "development_plan",
            "test_cases",
            "pre_dev_approval",
            "analysis",
            "plan",
            "review_plan",
        ],
    },
    "developer": {
        "id": "developer",
        "label": "Developer Agent",
        "steps": ["environment_setup", "branch", "agent"],
    },
    "reviewer": {
        "id": "reviewer",
        "label": "Reviewer Agent",
        "steps": ["code_review", "ai_review"],
    },
    "qa": {
        "id": "qa",
        "label": "QA Agent",
        "steps": ["tests", "magento_validate", "qa"],
    },
    "deployment": {
        "id": "deployment",
        "label": "Deployment Agent",
        "steps": ["deploy", "commit", "pr", "jira_comment"],
    },
}


def agent_for_step(step: str) -> str | None:
    from services.workflow import migrate_step

    step = migrate_step(step)
    for agent_id, cfg in AGENT_REGISTRY.items():
        if step in cfg["steps"]:
            return agent_id
    return None
