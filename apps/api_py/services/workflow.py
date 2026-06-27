"""Task workflow state and helpers."""

from database import now_iso

WORKFLOW_STEPS = [
    "select",
    "requirement_analysis",
    "environment_setup",
    "architecture_design",
    "development_plan",
    "test_cases",
    "pre_dev_approval",
    "agent",
    "code_review",
    "deploy",
    "commit",
    "qa",
    "jira_comment",
    "done",
]

LEGACY_STEP_MAP = {
    "branch": "environment_setup",
    "describe": "requirement_analysis",
    "plan": "development_plan",
    "review_plan": "pre_dev_approval",
}

STEP_LABELS = {
    "select": "Select",
    "requirement_analysis": "Analysis",
    "environment_setup": "Setup",
    "architecture_design": "Architecture",
    "development_plan": "Plan",
    "test_cases": "Test Cases",
    "pre_dev_approval": "Approval",
    "agent": "Code",
    "deploy": "Build",
    "code_review": "Review",
    "commit": "Git",
    "qa": "QA",
    "jira_comment": "Jira",
    "done": "Done",
}

AGENT_PROGRESS_STEPS = [
    "Reading files",
    "Generating code",
    "Updating configuration",
    "Creating templates",
    "Running formatting",
]

DEV_AGENT_OPTIONS = {
    "magento": "Magento Developer",
    "react": "React Developer",
    "laravel": "Laravel Developer",
    "qa": "QA Engineer",
}


def migrate_step(step: str) -> str:
    return LEGACY_STEP_MAP.get(step, step)


def migrate_steps(steps: list[str]) -> list[str]:
    out: list[str] = []
    for s in steps:
        mapped = migrate_step(s)
        if mapped not in out:
            out.append(mapped)
    return out


def step_index(step: str) -> int:
    step = migrate_step(step)
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
        "customTaskKey": None,
        "customRequirements": None,
        "requirementAnalysis": None,
        "architectureDesign": None,
        "planMarkdown": None,
        "planTasks": None,
        "planFilePath": None,
        "testCases": None,
        "devAgentId": "magento",
        "planApprovedAt": None,
        "planApprovedBy": None,
        "preDevApprovedAt": None,
        "preDevApprovedBy": None,
        "approvalStatus": "draft",
        "aiReview": None,
        "jiraCommentPostedAt": None,
        "jiraCommentId": None,
        "jiraCommentText": None,
        "testPassRate": None,
    }


def extract_workflow(detail: dict) -> dict:
    current = migrate_step(detail.get("currentStep") or "select")
    completed = migrate_steps(detail.get("completedSteps") or [])
    pre_dev_at = detail.get("preDevApprovedAt") or detail.get("planApprovedAt")
    pre_dev_by = detail.get("preDevApprovedBy") or detail.get("planApprovedBy")
    status = detail.get("approvalStatus") or "draft"
    if status == "plan_pending":
        status = "pre_dev_pending"
    elif status == "plan_approved":
        status = "pre_dev_approved"
    return {
        "currentStep": current,
        "completedSteps": completed,
        "jiraSnapshot": detail.get("jiraSnapshot"),
        "customTitle": detail.get("customTitle"),
        "customTaskKey": detail.get("customTaskKey"),
        "customRequirements": detail.get("customRequirements"),
        "requirementAnalysis": detail.get("requirementAnalysis"),
        "architectureDesign": detail.get("architectureDesign"),
        "planMarkdown": detail.get("planMarkdown"),
        "planTasks": detail.get("planTasks"),
        "planFilePath": detail.get("planFilePath"),
        "testCases": detail.get("testCases"),
        "devAgentId": detail.get("devAgentId") or "magento",
        "planApprovedAt": pre_dev_at,
        "planApprovedBy": pre_dev_by,
        "preDevApprovedAt": pre_dev_at,
        "preDevApprovedBy": pre_dev_by,
        "approvalStatus": status,
        "aiReview": detail.get("aiReview"),
        "jiraCommentPostedAt": detail.get("jiraCommentPostedAt"),
        "jiraCommentId": detail.get("jiraCommentId"),
        "jiraCommentText": detail.get("jiraCommentText"),
        "testPassRate": detail.get("testPassRate"),
        "artifactsForTaskKey": detail.get("artifactsForTaskKey"),
        "artifactsForTaskSummary": detail.get("artifactsForTaskSummary"),
        "agentGeneration": detail.get("agentGeneration"),
        "llmOverride": bool(detail.get("llmOverride")),
        "codingProvider": detail.get("codingProvider"),
        "codingModel": detail.get("codingModel"),
    }


def mark_completed(completed: list[str], step: str) -> list[str]:
    step = migrate_step(step)
    out = migrate_steps(completed)
    if step not in out:
        out.append(step)
    return out


def can_navigate_to(completed: list[str], current: str, target: str) -> bool:
    current = migrate_step(current)
    target = migrate_step(target)
    if target == current:
        return True
    target_idx = step_index(target)
    current_idx = step_index(current)
    if target_idx < 0 or current_idx < 0:
        return False
    if target_idx < current_idx:
        return True
    if target_idx == current_idx + 1:
        return True
    return target in migrate_steps(completed)


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
    git = detail.get("git") or {}
    deploy = detail.get("deploy") or {}
    jira = wf.get("jiraSnapshot") or {}
    lines = [
        "## CPWork — Development Complete",
        "",
    ]
    if jira.get("key"):
        summary = jira.get("summary") or ""
        lines.append(f"**Task:** {jira['key']}" + (f" — {summary}" if summary else ""))
        lines.append("")
    lines.extend([
        "### Run details",
        f"- **Branch:** `{run.get('branchName') or '—'}`",
        f"- **AI:** {run.get('provider') or '—'} / {run.get('model') or '—'}",
        f"- **Workflow status:** {wf.get('approvalStatus') or '—'}",
    ])
    if wf.get("testPassRate"):
        lines.append(f"- **QA pass rate:** {wf['testPassRate']}")
    if git.get("prUrl"):
        lines.append(f"- **Pull request:** {git['prUrl']}")
    elif git.get("pushed"):
        lines.append("- **Branch pushed:** yes")
    if deploy.get("ok"):
        lines.append("- **Build verification:** passed")
    elif deploy and not deploy.get("running"):
        lines.append("- **Build verification:** failed or incomplete")
    lines.append("")

    analysis = wf.get("requirementAnalysis") or {}
    if analysis.get("summary") or analysis.get("objective"):
        lines.append("### Requirement analysis")
        if analysis.get("summary"):
            lines.append(analysis["summary"])
        if analysis.get("objective") and analysis.get("objective") != analysis.get("summary"):
            lines.append(f"**Objective:** {analysis['objective']}")
        func = analysis.get("functionalRequirements") or []
        if func:
            lines.append("**Functional requirements:**")
            for item in func[:8]:
                lines.append(f"- {item}")
            if len(func) > 8:
                lines.append(f"- _…and {len(func) - 8} more_")
        lines.append("")

    arch = wf.get("architectureDesign") or {}
    if arch.get("systemOverview"):
        lines.append("### Architecture")
        overview = arch["systemOverview"].strip()
        if len(overview) > 600:
            overview = overview[:597] + "…"
        lines.append(overview)
        files_mod = arch.get("filesToModify") or []
        if files_mod:
            lines.append("**Files to modify:** " + ", ".join(f"`{f}`" for f in files_mod[:10]))
        lines.append("")

    plan_tasks = wf.get("planTasks") or []
    if plan_tasks:
        lines.append("### Implementation plan")
        for task in plan_tasks[:12]:
            title = task.get("title") or "Task"
            file_hint = task.get("file")
            suffix = f" (`{file_hint}`)" if file_hint else ""
            lines.append(f"- {title}{suffix}")
        if len(plan_tasks) > 12:
            lines.append(f"- _…and {len(plan_tasks) - 12} more tasks_")
        lines.append("")

    test_cases = wf.get("testCases") or []
    if test_cases:
        lines.append("### Test cases covered")
        for tc in test_cases[:8]:
            lines.append(f"- {tc.get('title') or tc.get('id')}")
        if len(test_cases) > 8:
            lines.append(f"- _…and {len(test_cases) - 8} more_")
        lines.append("")

    output = detail.get("output") or {}
    if output.get("summary"):
        lines.extend(["### Code summary", output["summary"], ""])

    ai_review = wf.get("aiReview") or {}
    if ai_review.get("summary") or ai_review.get("issuesFound"):
        lines.append("### AI code review")
        if ai_review.get("summary"):
            lines.append(ai_review["summary"])
        score = ai_review.get("codeQualityScore")
        if score is not None:
            lines.append(f"**Quality score:** {score}/10")
        issues = ai_review.get("issuesFound")
        if issues is not None:
            lines.append(f"**Issues found:** {issues}")
        lines.append("")

    test = detail.get("test")
    if test and test.get("steps"):
        lines.append("### QA results")
        lines.append("| Check | Result |")
        lines.append("| --- | --- |")
        for step in test["steps"]:
            if step.get("skipped"):
                result = "Skipped"
            elif step.get("ok"):
                result = "Pass"
            else:
                result = "Fail"
            lines.append(f"| {step.get('label', step.get('key'))} | {result} |")
        lines.append("")

    if output.get("files"):
        lines.append("### Files changed")
        for f in output["files"]:
            action = (f.get("action") or "modify").capitalize()
            lines.append(f"- **{action}:** `{f.get('path')}`")
        lines.append("")

    checklist = output.get("manualTestChecklist") or []
    if checklist:
        lines.append("### Manual test checklist")
        for item in checklist:
            lines.append(f"- [ ] {item}")
        lines.append("")

    if wf.get("planFilePath"):
        lines.append(f"**Plan file:** `{wf['planFilePath']}`")
        lines.append("")

    lines.append("---")
    lines.append("_Posted automatically by CPWork_")
    return "\n".join(lines)
