"""11-step task workflow state and helpers."""

from database import now_iso

WORKFLOW_STEPS = [
    "select",
    "branch",
    "describe",
    "plan",
    "review_plan",
    "agent",
    "code_review",
    "deploy",
    "commit",
    "jira_comment",
    "done",
]

STEP_LABELS = {
    "select": "Select",
    "branch": "Branch",
    "describe": "Describe",
    "plan": "Plan",
    "review_plan": "Review",
    "agent": "Code",
    "code_review": "Review",
    "deploy": "Deploy",
    "commit": "Commit",
    "jira_comment": "Jira",
    "done": "Done",
}

AGENT_PROGRESS_STEPS = [
    "Analyzing requirements",
    "Scanning codebase",
    "Generating file changes",
    "Validating diffs",
    "Preparing summary",
]


def step_index(step: str) -> int:
    try:
        return WORKFLOW_STEPS.index(step)
    except ValueError:
        return -1


def empty_workflow_state() -> dict:
    return {
        "currentStep": "select",
        "completedSteps": [],
        "jiraSnapshot": None,
        "customTitle": None,
        "planMarkdown": None,
        "planFilePath": None,
        "planApprovedAt": None,
        "planApprovedBy": None,
        "approvalStatus": "draft",
        "jiraCommentPostedAt": None,
        "jiraCommentId": None,
        "jiraCommentText": None,
        "testPassRate": None,
    }


def extract_workflow(detail: dict) -> dict:
    return {
        "currentStep": detail.get("currentStep") or "select",
        "completedSteps": detail.get("completedSteps") or [],
        "jiraSnapshot": detail.get("jiraSnapshot"),
        "customTitle": detail.get("customTitle"),
        "planMarkdown": detail.get("planMarkdown"),
        "planFilePath": detail.get("planFilePath"),
        "planApprovedAt": detail.get("planApprovedAt"),
        "planApprovedBy": detail.get("planApprovedBy"),
        "approvalStatus": detail.get("approvalStatus") or "draft",
        "jiraCommentPostedAt": detail.get("jiraCommentPostedAt"),
        "jiraCommentId": detail.get("jiraCommentId"),
        "jiraCommentText": detail.get("jiraCommentText"),
        "testPassRate": detail.get("testPassRate"),
    }


def mark_completed(completed: list[str], step: str) -> list[str]:
    out = list(completed)
    if step not in out:
        out.append(step)
    return out


def can_navigate_to(completed: list[str], current: str, target: str) -> bool:
    if target == current:
        return True
    target_idx = step_index(target)
    current_idx = step_index(current)
    if target_idx < 0 or current_idx < 0:
        return False
    # Back to any earlier step
    if target_idx < current_idx:
        return True
    # Forward one step (Continue button)
    if target_idx == current_idx + 1:
        return True
    # Jump forward only to steps already completed
    return target in completed


def compute_test_pass_rate(test: dict | None) -> str | None:
    if not test or not test.get("steps"):
        return None
    steps = [s for s in test["steps"] if not s.get("skipped")]
    if not steps:
        return None
    passed = sum(1 for s in steps if s.get("ok"))
    return f"{passed}/{len(steps)}"


def jira_snapshot_from_issue(issue: dict) -> dict:
    return {
        "key": issue.get("key"),
        "summary": issue.get("summary"),
        "description": issue.get("description") or "",
        "issueType": issue.get("issueType"),
        "priority": issue.get("priority"),
        "labels": issue.get("labels") or [],
        "components": issue.get("components") or [],
        "assignee": issue.get("assignee"),
        "status": issue.get("status"),
        "statusCategory": issue.get("statusCategory"),
        "url": issue.get("url"),
        "attachments": issue.get("attachments") or [],
    }


def format_jira_comment(run: dict, detail: dict, project: dict) -> str:
    wf = extract_workflow(detail)
    lines = [
        "## CPWork Run Summary",
        f"**Branch:** `{run.get('branchName') or '—'}`",
        f"**Provider:** {run.get('provider') or '—'} / {run.get('model') or '—'}",
        f"**Status:** {wf['approvalStatus']}",
        "",
    ]
    output = detail.get("output") or {}
    if output.get("summary"):
        lines.extend(["### Summary", output["summary"], ""])
    test = detail.get("test")
    if test and test.get("steps"):
        lines.append("### Test Results")
        lines.append("| Test | Result |")
        lines.append("|------|--------|")
        for step in test["steps"]:
            if step.get("skipped"):
                result = "skipped"
            elif step.get("ok"):
                result = "Pass"
            else:
                result = "FAIL"
            lines.append(f"| {step.get('label', step.get('key'))} | {result} |")
        lines.append("")
    if output.get("files"):
        lines.append("### Files Changed")
        for f in output["files"]:
            lines.append(f"- {f.get('action')}: {f.get('path')}")
        lines.append("")
    checklist = output.get("manualTestChecklist") or []
    if checklist:
        lines.append("### Manual Test Checklist")
        for item in checklist:
            lines.append(f"- [ ] {item}")
        lines.append("")
    if wf.get("planFilePath"):
        lines.append(f"**Plan file:** `{wf['planFilePath']}`")
        lines.append("")
    lines.append("---")
    lines.append("_Auto-posted by CPWork_")
    return "\n".join(lines)
