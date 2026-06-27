"""Validate and heal workflow run detail so pre-dev artifacts match the active task."""

from __future__ import annotations

PRE_DEV_ARTIFACT_KEYS = (
    "requirementAnalysis",
    "architectureDesign",
    "planMarkdown",
    "planTasks",
    "planFilePath",
    "testCases",
    "planApprovedAt",
    "planApprovedBy",
    "preDevApprovedAt",
    "preDevApprovedBy",
)


def task_identity(run: dict, detail: dict) -> tuple[str | None, str | None]:
    """Return (task key, task title/summary) for artifact binding."""
    jira_key = (run.get("jiraKey") or "").strip() or None
    snap = detail.get("jiraSnapshot") if isinstance(detail.get("jiraSnapshot"), dict) else {}
    summary = (snap.get("summary") or "").strip() or None
    if jira_key:
        return jira_key, summary
    custom = (detail.get("customTitle") or run.get("summary") or "").strip() or None
    return custom, custom


def clear_pre_dev_artifacts(detail: dict) -> dict:
    out = dict(detail)
    for key in PRE_DEV_ARTIFACT_KEYS:
        out[key] = None
    out["artifactsForTaskKey"] = None
    out["artifactsForTaskSummary"] = None
    return out


def has_pre_dev_artifacts(detail: dict) -> bool:
    return bool(
        detail.get("requirementAnalysis")
        or detail.get("architectureDesign")
        or detail.get("planMarkdown")
        or detail.get("testCases")
    )


def artifacts_match_task(run: dict, detail: dict) -> bool:
    if not has_pre_dev_artifacts(detail):
        return True
    key, summary = task_identity(run, detail)
    stored_key = (detail.get("artifactsForTaskKey") or "").strip() or None
    stored_summary = (detail.get("artifactsForTaskSummary") or "").strip() or None

    jira_key = (run.get("jiraKey") or "").strip()
    if jira_key:
        snap = detail.get("jiraSnapshot")
        snap_key = snap.get("key") if isinstance(snap, dict) else None
        if snap_key and snap_key != jira_key:
            return False

    if stored_key and key and stored_key != key:
        return False
    if stored_summary and summary and stored_summary != summary:
        return False
    # Legacy artifacts without a stamp must be regenerated once we know the ticket title.
    if summary and not stored_summary:
        return False
    return True


def stamp_artifacts(detail: dict, run: dict) -> dict:
    key, summary = task_identity(run, detail)
    out = dict(detail)
    out["artifactsForTaskKey"] = key
    out["artifactsForTaskSummary"] = summary
    return out


def sanitize_workflow_detail(run: dict, detail: dict) -> tuple[dict, bool]:
    """Remove pre-dev artifacts when they belong to a different task. Returns (detail, changed)."""
    if not has_pre_dev_artifacts(detail):
        return detail, False
    if artifacts_match_task(run, detail):
        return detail, False
    return clear_pre_dev_artifacts(detail), True
