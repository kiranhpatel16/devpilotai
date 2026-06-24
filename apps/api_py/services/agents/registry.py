"""Agent registry and definitions."""

AGENT_REGISTRY = {
    "planner": {
        "id": "planner",
        "label": "Planner Agent",
        "steps": ["select", "analysis", "plan", "review_plan"],
    },
    "developer": {
        "id": "developer",
        "label": "Developer Agent",
        "steps": ["branch", "agent"],
    },
    "reviewer": {
        "id": "reviewer",
        "label": "Reviewer Agent",
        "steps": ["code_review", "ai_review"],
    },
    "qa": {
        "id": "qa",
        "label": "QA Agent",
        "steps": ["tests", "magento_validate"],
    },
    "deployment": {
        "id": "deployment",
        "label": "Deployment Agent",
        "steps": ["deploy", "commit", "pr", "jira_comment"],
    },
}


def agent_for_step(step: str) -> str | None:
    for agent_id, cfg in AGENT_REGISTRY.items():
        if step in cfg["steps"]:
            return agent_id
    return None
