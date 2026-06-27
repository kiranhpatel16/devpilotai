"""Workflow artifact generation helpers."""

import json
import re
from services.agents.orchestrator import orchestrator


def parse_plan_tasks(plan_text: str) -> list[dict]:
    """Extract structured tasks from plan markdown numbered lists."""
    tasks: list[dict] = []
    pattern = re.compile(
        r"^\s*(?:\d+[\.\)]|[-*])\s+(.+?)(?:\s+[-—]\s*(\d+)\s*min)?\s*$",
        re.MULTILINE | re.IGNORECASE,
    )
    for i, match in enumerate(pattern.finditer(plan_text or ""), start=1):
        title = match.group(1).strip()
        mins = int(match.group(2)) if match.group(2) else None
        file_match = re.search(r"`([^`]+)`", title)
        tasks.append({
            "id": str(i),
            "title": title,
            "file": file_match.group(1) if file_match else None,
            "estimatedMinutes": mins,
        })
    return tasks[:30]


async def generate_requirement_analysis(provider: str, model: str | None, ctx: dict) -> dict:
    return await orchestrator.run_for_step("requirement_analysis", provider, model, ctx)


async def generate_architecture_design(provider: str, model: str | None, ctx: dict) -> dict:
    return await orchestrator.run_for_step("architecture_design", provider, model, ctx)


async def generate_test_cases(provider: str, model: str | None, ctx: dict) -> dict:
    return await orchestrator.run_for_step("test_cases", provider, model, ctx)


def merge_plan_tasks_from_ai(plan_text: str, output: dict) -> list[dict]:
    parsed = parse_plan_tasks(plan_text)
    if parsed:
        return parsed
    text = output.get("text") or ""
    try:
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            data = json.loads(match.group(0))
            tasks = data.get("planTasks") or data.get("tasks")
            if isinstance(tasks, list) and tasks:
                return tasks
    except Exception:
        pass
    return parsed
