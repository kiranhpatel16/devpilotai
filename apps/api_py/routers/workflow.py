from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
import re as re_module
import asyncio
from lib.errors import HttpError
from middleware.auth import get_auth, is_admin_role, can_write_on_project
from db.runs import runs_repo
from db.project_roles import project_roles_repo
from db.activities import activities_repo
from db.ai_settings import run_usage_repo
from db.projects import projects_repo
from db.users import users_repo
from services.environment import resolve_environment
from services.jira_service import get_issue_detail, post_issue_comment
from services.ai_service import run_ai
from services.repo_context import enrich_repo_context, build_repo_context
from services.git_service import (
    compute_diffs,
    create_branch,
    get_status,
    get_recent_commits
)
from services.run_detail import load_detail, patch_detail, save_detail
from services.task_plan_storage import save_task_plan, read_task_plan
from services.ai_providers.registry import enabled_provider_info
from services.workflow import (
    WORKFLOW_STEPS,
    can_navigate_to,
    compute_test_pass_rate,
    empty_workflow_state,
    extract_workflow,
    format_jira_comment,
    jira_snapshot_from_issue,
    mark_completed,
    step_index,
)
from services.deploy_profile import deploy_profile_reason, resolve_deploy_profile
from services.deploy_service import run_local_deploy
from services.deploy_error_service import (
    analyze_deploy_failure,
    build_auto_fix_proposals,
    build_php_syntax_auto_fix,
    enrich_deploy_report,
    gather_deploy_fix_excerpts,
)
from services.test_error_service import (
    analyze_test_failure,
    build_phpunit_auto_fix,
    gather_test_fix_excerpts,
)
from database import now_iso

router = APIRouter(prefix="/api/workflow", tags=["workflow"])

_deploy_tasks: dict[str, asyncio.Task] = {}


class StartWorkflowBody(BaseModel):
    projectId: str
    jiraKey: Optional[str] = None
    customTitle: Optional[str] = None
    customTaskKey: Optional[str] = None
    customRequirements: Optional[str] = None


class UpdateStepBody(BaseModel):
    step: str
    branchName: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    userInstructions: Optional[str] = None
    customTitle: Optional[str] = None


class SavePlanBody(BaseModel):
    planMarkdown: str


class PostJiraCommentBody(BaseModel):
    comment: str


class CommitBody(BaseModel):
    message: str


class BulkDeleteBody(BaseModel):
    runIds: list[str]


def _sanitize_branch(name: str) -> str:
    return re_module.sub(r"[^A-Za-z0-9._\-/]", "-", name.strip())


def _assert_project_access(auth: dict, project_id: str, write: bool = False):
    if is_admin_role(auth["role"]):
        return
    role = project_roles_repo.get_role(auth["sub"], project_id)
    if not role:
        raise HttpError.forbidden("You are not assigned to this project")
    if write and not can_write_on_project(role):
        raise HttpError.forbidden("Your project role cannot run Agent mode")


def _load_workflow_run(run_id: str, auth: dict) -> dict:
    run = runs_repo.find_by_id(run_id)
    if not run:
        raise HttpError.not_found("Run not found")
    if run["mode"] != "workflow":
        raise HttpError.bad_request("Not a workflow run")
    if run["userId"] != auth["sub"] and not is_admin_role(auth["role"]):
        raise HttpError.forbidden()
    return run


def _pick_provider(requested: str | None) -> str:
    if requested:
        return requested
    enabled = enabled_provider_info()
    if not enabled:
        raise HttpError.bad_request("No AI provider is enabled. Configure one in Admin → AI Providers.")
    return enabled[0]["id"]


def _task_key(run: dict, detail: dict) -> str:
    return (run.get("jiraKey") or "").strip() or detail.get("customTitle") or run["id"]


def _jira_for_run(run: dict, detail: dict) -> dict | None:
    snap = detail.get("jiraSnapshot")
    return snap if isinstance(snap, dict) and snap.get("key") else None


def _assemble_detail(run_id: str) -> dict:
    from routers.runs import _assemble_detail as base_assemble
    return base_assemble(run_id)


def _init_detail() -> dict:
    from services.run_detail import EMPTY_DETAIL

    return {**EMPTY_DETAIL, **empty_workflow_state()}


async def _build_ai_context(run: dict, detail: dict, resolved: dict):
    jira = _jira_for_run(run, detail)
    task_text = " ".join(filter(None, [
        jira["summary"] if jira else detail.get("customTitle"),
        jira.get("description") if jira else detail.get("customRequirements"),
        run.get("userInstructions"),
        run.get("branchName"),
    ]))
    repo = enrich_repo_context(
        resolved["cwd"],
        task_text,
        resolved["project"].get("frontendTheme"),
        plan_markdown=detail.get("planMarkdown"),
        prior_output=detail.get("output"),
    )
    return {
        "project": resolved["project"],
        "cwd": resolved["cwd"],
        "frontendUrl": resolved["frontendUrl"],
        "backendUrl": resolved["backendUrl"],
        "jira": jira,
        "jiraKey": run.get("jiraKey"),
        "userInstructions": run.get("userInstructions"),
        "activeTheme": resolved["project"].get("frontendTheme"),
        "repoOverview": repo["overview"],
        "fileExcerpts": repo["excerpts"],
    }


async def _build_deploy_fix_context(
    run: dict,
    detail: dict,
    resolved: dict,
    deploy: dict | None,
    analysis: dict,
) -> dict:
    """Slim AI context for deploy-fix — avoids blowing the model context window."""
    jira = _jira_for_run(run, detail)
    task_text = " ".join(filter(None, [
        jira["summary"] if jira else detail.get("customTitle"),
        analysis.get("summary"),
        " ".join(analysis.get("errorFiles") or []),
        run.get("branchName"),
    ]))
    repo = build_repo_context(resolved["cwd"], task_text, resolved["project"].get("frontendTheme"))
    last_fix = (deploy or {}).get("lastFix")
    last_failed_fix = last_fix if last_fix and last_fix.get("status") == "failed" else None
    return {
        "project": resolved["project"],
        "cwd": resolved["cwd"],
        "frontendUrl": resolved["frontendUrl"],
        "backendUrl": resolved["backendUrl"],
        "jira": jira,
        "jiraKey": run.get("jiraKey"),
        "userInstructions": run.get("userInstructions"),
        "activeTheme": resolved["project"].get("frontendTheme"),
        "repoOverview": repo["overview"],
        "fileExcerpts": [],
        "mode": "deploy_fix",
        "deployAnalysis": analysis,
        "deployOutput": analysis.get("rawOutput") or "",
        "approvedPlanMarkdown": detail.get("planMarkdown"),
        "lastFailedFix": last_failed_fix,
        "deployFileExcerpts": gather_deploy_fix_excerpts(
            resolved["cwd"], deploy, analysis,
        ),
        "phpBin": resolved["env"].get("phpBin") or "php",
        "dockerComposePath": resolved["env"].get("dockerComposePath"),
        "deployLastFix": (deploy or {}).get("lastFix"),
    }


async def _build_test_fix_context(
    run: dict,
    detail: dict,
    resolved: dict,
    test_report: dict | None,
    analysis: dict,
) -> dict:
    """Slim AI context for test-fix."""
    jira = _jira_for_run(run, detail)
    task_text = " ".join(filter(None, [
        jira["summary"] if jira else detail.get("customTitle"),
        analysis.get("summary"),
        " ".join(analysis.get("errorFiles") or []),
        run.get("branchName"),
    ]))
    repo = build_repo_context(resolved["cwd"], task_text, resolved["project"].get("frontendTheme"))
    changed_paths = [f["path"] for f in (detail.get("output") or {}).get("files") or []]
    last_fix = (test_report or {}).get("lastFix")
    last_failed_fix = last_fix if last_fix and last_fix.get("status") == "failed" else None
    return {
        "project": resolved["project"],
        "cwd": resolved["cwd"],
        "frontendUrl": resolved["frontendUrl"],
        "backendUrl": resolved["backendUrl"],
        "jira": jira,
        "jiraKey": run.get("jiraKey"),
        "userInstructions": run.get("userInstructions"),
        "activeTheme": resolved["project"].get("frontendTheme"),
        "repoOverview": repo["overview"],
        "fileExcerpts": [],
        "mode": "test_fix",
        "testAnalysis": analysis,
        "testOutput": analysis.get("rawOutput") or "",
        "approvedPlanMarkdown": detail.get("planMarkdown"),
        "lastFailedFix": last_failed_fix,
        "testFileExcerpts": gather_test_fix_excerpts(
            resolved["cwd"], analysis, changed_paths,
        ),
        "phpBin": resolved["env"].get("phpBin") or "php",
        "dockerComposePath": resolved["env"].get("dockerComposePath"),
        "testLastFix": (test_report or {}).get("lastFix"),
    }


def _accessible_project_ids(auth: dict) -> list[str]:
    if is_admin_role(auth["role"]):
        return [p["id"] for p in projects_repo.list_all()]
    return [a["projectId"] for a in project_roles_repo.list_for_user(auth["sub"])]


def _can_delete_run(auth: dict, run: dict) -> bool:
    if run["userId"] == auth["sub"]:
        return True
    return is_admin_role(auth["role"])


def _history_row(run: dict, *, username: str | None = None, display_name: str | None = None, project_name: str | None = None) -> dict:
    detail = load_detail(run["id"])
    wf = extract_workflow(detail)
    user = users_repo.find_by_id(run["userId"]) if not username else None
    return {
        "runId": run["id"],
        "projectId": run["projectId"],
        "projectName": project_name,
        "userId": run["userId"],
        "username": username or (user["username"] if user else None),
        "displayName": display_name or (user["displayName"] if user else None),
        "jiraKey": run.get("jiraKey"),
        "customTitle": wf.get("customTitle"),
        "customTaskKey": wf.get("customTaskKey"),
        "customRequirements": wf.get("customRequirements"),
        "branchName": run.get("branchName"),
        "provider": run.get("provider"),
        "model": run.get("model"),
        "approvalStatus": run.get("approvalStatus") or wf["approvalStatus"],
        "testPassRate": wf.get("testPassRate"),
        "currentStep": run.get("currentStep") or wf["currentStep"],
        "summary": run.get("summary"),
        "createdAt": run["createdAt"],
        "updatedAt": run["updatedAt"],
    }


def _cancel_deploy_task(run_id: str) -> None:
    deploy_task = _deploy_tasks.pop(run_id, None)
    if deploy_task and not deploy_task.done():
        deploy_task.cancel()


@router.get("/history")
async def workflow_history(
    projectId: str,
    auth: dict = Depends(get_auth),
    userId: str | None = None,
    status: str | None = None,
    q: str | None = None,
    page: int = 1,
    pageSize: int = 20,
):
    _assert_project_access(auth, projectId)
    page = max(page, 1)
    page_size = min(max(pageSize, 1), 100)

    runs, total = runs_repo.list_workflow_history(
        [projectId],
        project_id=projectId,
        user_id=userId,
        approval_status=status,
        search=q,
        page=page,
        page_size=page_size,
    )
    rows = [
        _history_row(
            run,
            username=run.get("username"),
            display_name=run.get("displayName"),
            project_name=run.get("projectName"),
        )
        for run in runs
    ]
    users = runs_repo.list_distinct_history_users([projectId])
    return {
        "rows": rows,
        "total": total,
        "page": page,
        "pageSize": page_size,
        "filterUsers": users,
    }


@router.get("/history/global")
async def workflow_history_global(
    auth: dict = Depends(get_auth),
    projectId: str | None = None,
    userId: str | None = None,
    status: str | None = None,
    q: str | None = None,
    page: int = 1,
    pageSize: int = 20,
):
    project_ids = _accessible_project_ids(auth)
    page = max(page, 1)
    page_size = min(max(pageSize, 1), 100)

    runs, total = runs_repo.list_workflow_history(
        project_ids,
        project_id=projectId,
        user_id=userId,
        approval_status=status,
        search=q,
        page=page,
        page_size=page_size,
    )
    rows = [
        _history_row(
            run,
            username=run.get("username"),
            display_name=run.get("displayName"),
            project_name=run.get("projectName"),
        )
        for run in runs
    ]
    users = runs_repo.list_distinct_history_users(project_ids)
    return {
        "rows": rows,
        "total": total,
        "page": page,
        "pageSize": page_size,
        "filterUsers": users,
    }


@router.post("/runs", status_code=201)
async def start_workflow(body: StartWorkflowBody, auth: dict = Depends(get_auth)):
    _assert_project_access(auth, body.projectId)
    resolved = resolve_environment(auth["sub"], body.projectId)

    if not body.jiraKey and not (body.customTitle or "").strip():
        raise HttpError.bad_request("Select a Jira task or provide a custom title")

    jira_snapshot = None
    jira_key = body.jiraKey
    if jira_key:
        try:
            issue = await get_issue_detail(body.projectId, jira_key)
            jira_snapshot = jira_snapshot_from_issue(issue)
        except Exception:
            jira_snapshot = {"key": jira_key, "summary": jira_key, "description": ""}

    run = runs_repo.create({
        "projectId": body.projectId,
        "userId": auth["sub"],
        "jiraKey": jira_key,
        "mode": "workflow",
        "provider": None,
        "model": None,
        "branchName": None,
        "userInstructions": None,
        "status": "selected",
    })
    runs_repo.update_fields(run["id"], {
        "currentStep": "select",
        "approvalStatus": "draft",
    })

    detail = _init_detail()
    detail["jiraSnapshot"] = jira_snapshot
    custom_title = (body.customTitle or "").strip() or None
    detail["customTitle"] = custom_title
    detail["customTaskKey"] = (body.customTaskKey or "").strip() or None
    detail["customRequirements"] = (body.customRequirements or "").strip() or None

    if jira_key:
        detail["currentStep"] = "branch"
        detail["completedSteps"] = mark_completed([], "select")
        initial_step = "branch"
    else:
        detail["currentStep"] = "describe"
        detail["completedSteps"] = mark_completed(mark_completed([], "select"), "branch")
        initial_step = "describe"

    save_detail(run["id"], detail)

    runs_repo.update_fields(run["id"], {
        "currentStep": initial_step,
        "approvalStatus": "draft",
        "summary": custom_title,
    })

    activities_repo.create({
        "userId": auth["sub"], "username": auth["username"],
        "action": "workflow.started", "resourceType": "run",
        "resourceId": run["id"], "projectId": body.projectId,
        "projectName": resolved["project"]["name"],
        "jiraKey": jira_key,
        "summary": (
            f"{auth['username']} created custom task {custom_title}"
            if not jira_key
            else f"{auth['username']} started workflow for {jira_key}"
        ),
    })

    return {"detail": _assemble_detail(run["id"])}


@router.get("/runs/{run_id}")
async def get_workflow_run(run_id: str, auth: dict = Depends(get_auth)):
    _load_workflow_run(run_id, auth)
    return {"detail": _assemble_detail(run_id)}


@router.patch("/runs/{run_id}/step")
async def update_workflow_step(run_id: str, body: UpdateStepBody, auth: dict = Depends(get_auth)):
    run = _load_workflow_run(run_id, auth)
    detail = load_detail(run_id)
    wf = extract_workflow(detail)

    if body.step not in WORKFLOW_STEPS:
        raise HttpError.bad_request(f"Invalid step: {body.step}")

    if not can_navigate_to(wf["completedSteps"], wf["currentStep"], body.step):
        raise HttpError.bad_request("Cannot navigate to that step yet")

    patch = {"currentStep": body.step}
    run_fields = {"currentStep": body.step}

    if body.branchName is not None:
        branch = _sanitize_branch(body.branchName) if body.branchName.strip() else None
        run_fields["branchName"] = branch
    if body.provider is not None:
        run_fields["provider"] = _pick_provider(body.provider)
    if body.model is not None:
        run_fields["model"] = body.model or None
    if body.userInstructions is not None:
        run_fields["userInstructions"] = body.userInstructions or None
    if body.customTitle is not None:
        patch["customTitle"] = body.customTitle.strip() or None

    target_idx = step_index(body.step)
    current_idx = step_index(wf["currentStep"])
    if target_idx > current_idx:
        patch["completedSteps"] = mark_completed(wf["completedSteps"], wf["currentStep"])

    patch_detail(run_id, patch)
    runs_repo.update_fields(run_id, run_fields)
    return {"detail": _assemble_detail(run_id)}


@router.get("/runs/{run_id}/saved-plan")
async def get_saved_plan(run_id: str, auth: dict = Depends(get_auth)):
    run = _load_workflow_run(run_id, auth)
    detail = load_detail(run_id)
    wf = extract_workflow(detail)
    plan_path = detail.get("planFilePath") or wf.get("planFilePath")
    if not plan_path:
        raise HttpError.not_found("No saved plan file")
    try:
        plan_text = read_task_plan(plan_path)
    except FileNotFoundError as err:
        raise HttpError.not_found(str(err)) from err
    except ValueError as err:
        raise HttpError.bad_request(str(err)) from err
    return {"planMarkdown": plan_text, "planFilePath": plan_path}


@router.post("/runs/{run_id}/generate-plan")
async def generate_plan(run_id: str, auth: dict = Depends(get_auth)):
    run = _load_workflow_run(run_id, auth)
    detail = load_detail(run_id)
    resolved = resolve_environment(run["userId"], run["projectId"])
    provider = _pick_provider(run.get("provider"))

    try:
        ctx = await _build_ai_context(run, detail, resolved)
        ctx["mode"] = "plan"
        ai_result = await run_ai(provider, run.get("model"), ctx)
        run_usage_repo.record(run_id, ai_result["usage"])
        output = ai_result["output"]
        plan_text = output.get("text") or ""
        task_key = _task_key(run, detail)
        plan_path = save_task_plan(
            project_slug=resolved["project"]["slug"],
            project_name=resolved["project"]["name"],
            task_key=task_key,
            plan_text=plan_text,
        ) if plan_text else None

        wf = extract_workflow(detail)
        patch_detail(run_id, {
            "output": output,
            "usage": ai_result["usage"],
            "planMarkdown": plan_text,
            "planFilePath": plan_path,
            "currentStep": "review_plan",
            "completedSteps": mark_completed(mark_completed(wf["completedSteps"], "plan"), "describe"),
            "approvalStatus": "plan_pending",
        })
        runs_repo.update_fields(run_id, {
            "currentStep": "review_plan",
            "approvalStatus": "plan_pending",
            "provider": provider,
            "summary": output.get("summary") or None,
        })
        runs_repo.set_error(run_id, None)
        return {"detail": _assemble_detail(run_id)}
    except Exception as err:
        runs_repo.set_error(run_id, str(err))
        patch_detail(run_id, {"approvalStatus": "failed"})
        runs_repo.update_fields(run_id, {"approvalStatus": "failed"})
        raise


@router.post("/runs/{run_id}/regenerate-plan")
async def regenerate_plan(run_id: str, auth: dict = Depends(get_auth)):
    return await generate_plan(run_id, auth)


@router.patch("/runs/{run_id}/plan")
async def save_plan(run_id: str, body: SavePlanBody, auth: dict = Depends(get_auth)):
    run = _load_workflow_run(run_id, auth)
    detail = load_detail(run_id)
    resolved = resolve_environment(run["userId"], run["projectId"])
    task_key = _task_key(run, detail)
    plan_path = save_task_plan(
        project_slug=resolved["project"]["slug"],
        project_name=resolved["project"]["name"],
        task_key=task_key,
        plan_text=body.planMarkdown,
    )
    patch_detail(run_id, {
        "planMarkdown": body.planMarkdown,
        "planFilePath": plan_path,
    })
    return {"detail": _assemble_detail(run_id)}


@router.post("/runs/{run_id}/approve-plan")
async def approve_plan(run_id: str, auth: dict = Depends(get_auth)):
    run = _load_workflow_run(run_id, auth)
    _assert_project_access(auth, run["projectId"], write=True)
    detail = load_detail(run_id)
    if not detail.get("planMarkdown"):
        raise HttpError.bad_request("No plan to approve")

    wf = extract_workflow(detail)
    patch_detail(run_id, {
        "planApprovedAt": now_iso(),
        "planApprovedBy": auth["sub"],
        "approvalStatus": "plan_approved",
        "currentStep": "agent",
        "completedSteps": mark_completed(wf["completedSteps"], "review_plan"),
    })
    runs_repo.update_fields(run_id, {
        "approvalStatus": "plan_approved",
        "currentStep": "agent",
    })
    return {"detail": _assemble_detail(run_id)}


@router.post("/runs/{run_id}/run-agent")
async def run_agent(run_id: str, auth: dict = Depends(get_auth)):
    run = _load_workflow_run(run_id, auth)
    _assert_project_access(auth, run["projectId"], write=True)
    detail = load_detail(run_id)
    if not detail.get("planApprovedAt"):
        raise HttpError.forbidden("Approve the plan before running the agent")
    if not run.get("branchName"):
        raise HttpError.bad_request("Branch name is required")

    resolved = resolve_environment(run["userId"], run["projectId"])
    provider = _pick_provider(run.get("provider"))

    try:
        branch_info = await create_branch(
            resolved["cwd"], run["branchName"], resolved["project"]["git"]["productionBranch"],
        )
        ctx = await _build_ai_context(run, detail, resolved)
        ctx["mode"] = "agent"
        ctx["approvedPlanMarkdown"] = detail.get("planMarkdown")
        ai_result = await run_ai(provider, run.get("model"), ctx)
        run_usage_repo.record(run_id, ai_result["usage"])
        output = ai_result["output"]
        validation = ai_result.get("validation") or {}
        blocking = validation.get("blocking") or output.get("validationErrors") or []
        from services.agent_output_validator import quality_error_message

        runs_repo.set_error(run_id, quality_error_message(blocking))

        diffs = compute_diffs(resolved["cwd"], output["files"]) if output.get("files") else []
        git = await get_status(resolved["cwd"], resolved["project"]["git"]["productionBranch"])
        git["branch"] = run["branchName"]
        git["baseRef"] = branch_info.get("baseRef")
        if branch_info.get("stashed"):
            git["stashed"] = True

        wf = extract_workflow(detail)
        patch_detail(run_id, {
            "output": output,
            "diffs": diffs,
            "git": git,
            "usage": ai_result["usage"],
            "applied": False,
            "currentStep": "code_review",
            "completedSteps": mark_completed(wf["completedSteps"], "agent"),
            "approvalStatus": "code_pending",
        })
        runs_repo.update_fields(run_id, {
            "status": "awaiting_review",
            "currentStep": "code_review",
            "approvalStatus": "code_pending",
            "summary": output.get("summary") or None,
        })
        return {"detail": _assemble_detail(run_id)}
    except HttpError:
        raise
    except Exception as err:
        runs_repo.set_error(run_id, str(err))
        patch_detail(run_id, {"approvalStatus": "failed"})
        runs_repo.update_fields(run_id, {"approvalStatus": "failed", "status": "failed"})
        raise


@router.post("/runs/{run_id}/approve-code")
async def approve_code(run_id: str, auth: dict = Depends(get_auth)):
    run = _load_workflow_run(run_id, auth)
    detail = load_detail(run_id)
    wf = extract_workflow(detail)
    patch_detail(run_id, {
        "approvalStatus": "code_approved",
        "currentStep": "deploy",
        "completedSteps": mark_completed(wf["completedSteps"], "code_review"),
    })
    runs_repo.update_fields(run_id, {
        "approvalStatus": "code_approved",
        "currentStep": "deploy",
        "status": "deploy_ready",
    })
    return {"detail": _assemble_detail(run_id)}


def _schedule_deploy_job(
    run_id: str,
    cwd: str,
    php_bin: str,
    docker_compose_path: str | None,
    *,
    changed_paths: list[str] | None = None,
    project_deploy_mode: str = "auto",
    skip_composer_project: bool = False,
) -> None:
    if run_id in _deploy_tasks and not _deploy_tasks[run_id].done():
        return

    detail = load_detail(run_id)
    deploy_patch: dict = {
        "ranAt": now_iso(),
        "ok": False,
        "running": True,
        "steps": [],
    }
    extra_patch: dict = {"deploy": deploy_patch}
    if detail.get("diffs") and not detail.get("applied"):
        extra_patch["diffs"] = []
        extra_patch["output"] = None

    patch_detail(run_id, extra_patch)
    runs_repo.update_fields(run_id, {"status": "deploying"})

    async def on_progress(report: dict) -> None:
        patch_detail(run_id, {"deploy": report})

    async def job() -> None:
        try:
            report = await run_local_deploy(
                cwd,
                php_bin,
                docker_compose_path,
                on_progress=on_progress,
                changed_paths=changed_paths,
                project_deploy_mode=project_deploy_mode,
                skip_composer_project=skip_composer_project,
            )
            if not report.get("ok"):
                report = enrich_deploy_report(report, cwd)
                detail = load_detail(run_id)
                last_fix = (detail.get("deploy") or {}).get("lastFix")
                if last_fix and last_fix.get("status") == "applied":
                    report["lastFix"] = {**last_fix, "status": "failed", "failedAt": now_iso()}
            patch_detail(run_id, {"deploy": report})
            runs_repo.update_fields(run_id, {
                "status": "deploy_ready" if report["ok"] else "deploy_failed",
            })
        except Exception as exc:
            failed = enrich_deploy_report({
                "ranAt": now_iso(),
                "ok": False,
                "running": False,
                "steps": load_detail(run_id).get("deploy", {}).get("steps", []),
                "error": str(exc),
            }, cwd)
            patch_detail(run_id, {"deploy": failed})
            runs_repo.update_fields(run_id, {"status": "deploy_failed"})
        finally:
            _deploy_tasks.pop(run_id, None)

    _deploy_tasks[run_id] = asyncio.create_task(job())


@router.post("/runs/{run_id}/deploy")
async def deploy_locally(run_id: str, auth: dict = Depends(get_auth)):
    run = _load_workflow_run(run_id, auth)
    _assert_project_access(auth, run["projectId"], write=True)
    detail = load_detail(run_id)
    wf = extract_workflow(detail)
    if wf["currentStep"] != "deploy":
        raise HttpError.bad_request("Deploy is only available on the deploy step")
    if wf["approvalStatus"] != "code_approved":
        raise HttpError.bad_request("Approve code before deploying")

    existing = detail.get("deploy")
    if existing and existing.get("running"):
        if run_id in _deploy_tasks and not _deploy_tasks[run_id].done():
            return {"detail": _assemble_detail(run_id)}
        patch_detail(run_id, {"deploy": {**existing, "running": False}})

    resolved = resolve_environment(run["userId"], run["projectId"])
    php_bin = resolved["env"].get("phpBin") or "php"
    docker_compose_path = resolved["env"].get("dockerComposePath")
    cwd = resolved["cwd"]
    project = resolved["project"]
    defaults = project.get("defaults") or {}
    changed_paths = [f["path"] for f in (detail.get("output") or {}).get("files") or []]
    profile = resolve_deploy_profile(
        changed_paths,
        defaults.get("deployProfile") or "auto",
    )
    profile_reason = deploy_profile_reason(profile, changed_paths)

    _schedule_deploy_job(
        run_id,
        cwd,
        php_bin,
        docker_compose_path,
        changed_paths=changed_paths,
        project_deploy_mode=defaults.get("deployProfile") or "auto",
        skip_composer_project=bool(defaults.get("deploySkipComposer")),
    )
    existing_deploy = detail.get("deploy") or {}
    patch_detail(run_id, {
        "deploy": {
            **existing_deploy,
            "ranAt": now_iso(),
            "ok": False,
            "running": True,
            "steps": [],
            "runningStep": "docker_target",
            "profile": profile,
            "profileReason": profile_reason,
            "analysis": None,
            "error": None,
        },
    })
    runs_repo.update_fields(run_id, {"status": "deploying"})
    return {"detail": _assemble_detail(run_id)}


@router.post("/runs/{run_id}/deploy-fix")
async def deploy_fix(run_id: str, auth: dict = Depends(get_auth)):
    run = _load_workflow_run(run_id, auth)
    _assert_project_access(auth, run["projectId"], write=True)
    detail = load_detail(run_id)
    wf = extract_workflow(detail)
    if wf["currentStep"] != "deploy":
        raise HttpError.bad_request("Deploy fix is only available on the deploy step")

    deploy = detail.get("deploy")
    if deploy and deploy.get("running"):
        raise HttpError.bad_request("Deploy is still running")
    if deploy and deploy.get("ok"):
        raise HttpError.bad_request("Deploy already succeeded")

    resolved = resolve_environment(run["userId"], run["projectId"])
    cwd = resolved["cwd"]
    php_bin = resolved["env"].get("phpBin") or "php"
    docker_compose_path = resolved["env"].get("dockerComposePath")
    analysis = analyze_deploy_failure(deploy, cwd)
    if not analysis.get("rawOutput"):
        raise HttpError.bad_request("No deploy error output available to fix.")

    last_fix = (deploy or {}).get("lastFix")
    auto_output = build_auto_fix_proposals(cwd, analysis)
    if not auto_output:
        auto_output = build_php_syntax_auto_fix(cwd, analysis, php_bin, docker_compose_path)
    fix_mode = "auto"
    ai_result = None

    if auto_output:
        output = auto_output
    else:
        fix_mode = "ai"
        provider = _pick_provider(run.get("provider"))
        ctx = await _build_deploy_fix_context(run, detail, resolved, deploy, analysis)
        ai_result = await run_ai(provider, run.get("model"), ctx)
        run_usage_repo.record(run_id, ai_result["usage"])
        output = ai_result["output"]

    files = output.get("files") or []
    if not files:
        auto_output = build_php_syntax_auto_fix(cwd, analysis, php_bin, docker_compose_path)
        if auto_output:
            output = auto_output
            fix_mode = "auto"
            files = output.get("files") or []

    if not files:
        ai_errors = (ai_result or {}).get("validation", {}).get("blocking") or []
        hint = f" {'; '.join(ai_errors[:2])}" if ai_errors else ""
        raise HttpError(
            422,
            f"No valid fix could be generated for this deploy error.{hint}",
            "deploy_fix_empty",
        )

    from services.agent_output_validator import validate_deploy_fix_output
    validation = validate_deploy_fix_output(
        cwd, output, analysis, php_bin=php_bin, docker_compose_path=docker_compose_path,
    )
    if validation["blocking"] and fix_mode == "ai":
        auto_output = build_php_syntax_auto_fix(cwd, analysis, php_bin, docker_compose_path)
        if auto_output:
            output = auto_output
            fix_mode = "auto"
            files = output.get("files") or []
            validation = validate_deploy_fix_output(
                cwd, output, analysis, php_bin=php_bin, docker_compose_path=docker_compose_path,
            )
    if validation["blocking"]:
        if fix_mode == "auto":
            raise HttpError(
                422,
                "Auto-fix could not resolve the deploy error: "
                + "; ".join(validation["blocking"][:3]),
                "deploy_fix_failed",
                {"errors": validation["blocking"]},
            )
        raise HttpError(
            422,
            "Could not generate a valid fix. "
            + "; ".join(validation["blocking"][:3]),
            "deploy_fix_failed",
            {"errors": validation["blocking"]},
        )

    diffs = compute_diffs(cwd, files)
    diff_errors = [d for d in diffs if d.get("error")]
    if diff_errors:
        raise HttpError.bad_request(
            "Proposed fix could not be applied: "
            + "; ".join(f"{d['path']}: {d['error']}" for d in diff_errors[:3]),
        )

    git = await get_status(cwd, resolved["project"]["git"]["productionBranch"])
    git["branch"] = run.get("branchName")
    fix_summary = output.get("summary") or (
        "Auto-fixed known deploy error(s)" if fix_mode == "auto" else "AI agent proposed fixes for the deploy error"
    )

    patch_detail(run_id, {
        "output": output,
        "diffs": diffs,
        "applied": False,
        "backups": [],
        "git": git,
        "usage": ai_result["usage"] if ai_result else None,
        "deploy": {**(deploy or {}), "analysis": analysis, "lastFix": {
            "mode": fix_mode,
            "summary": fix_summary,
            "paths": [f["path"] for f in files],
            "previousPaths": (last_fix or {}).get("paths"),
            "at": now_iso(),
            "status": "proposed",
        }},
    })

    return {
        "detail": _assemble_detail(run_id),
        "fix": {"mode": fix_mode, "summary": fix_summary, "proposed": True},
    }


@router.post("/runs/{run_id}/test-fix")
async def test_fix(run_id: str, auth: dict = Depends(get_auth)):
    run = _load_workflow_run(run_id, auth)
    _assert_project_access(auth, run["projectId"], write=True)
    detail = load_detail(run_id)
    wf = extract_workflow(detail)
    if wf["currentStep"] not in ("deploy", "commit"):
        raise HttpError.bad_request("Test fix is only available after code is approved")

    test_report = detail.get("test")
    if not test_report or test_report.get("ok"):
        raise HttpError.bad_request("No failing test report to fix")
    if test_report.get("running"):
        raise HttpError.bad_request("Tests are still running")

    resolved = resolve_environment(run["userId"], run["projectId"])
    cwd = resolved["cwd"]
    analysis = analyze_test_failure(test_report)
    if not analysis.get("aiFixable"):
        raise HttpError.bad_request("No test failure output available to fix.")

    last_fix = (test_report or {}).get("lastFix")
    fix_mode = "auto"
    ai_result = None
    auto_output = build_phpunit_auto_fix(cwd, analysis)
    if auto_output:
        output = auto_output
    else:
        fix_mode = "ai"
        provider = _pick_provider(run.get("provider"))
        ctx = await _build_test_fix_context(run, detail, resolved, test_report, analysis)
        ai_result = await run_ai(provider, run.get("model"), ctx)
        run_usage_repo.record(run_id, ai_result["usage"])
        output = ai_result["output"]

    files = output.get("files") or []
    if not files and fix_mode == "ai":
        auto_output = build_phpunit_auto_fix(cwd, analysis)
        if auto_output:
            output = auto_output
            fix_mode = "auto"
            files = output.get("files") or []

    if not files:
        ai_errors = (ai_result or {}).get("validation", {}).get("blocking") or []
        hint = f" {'; '.join(ai_errors[:2])}" if ai_errors else ""
        raise HttpError(
            422,
            f"No valid fix could be generated for this test failure.{hint}",
            "test_fix_empty",
        )

    from services.agent_output_validator import validate_test_fix_output
    validation = validate_test_fix_output(
        cwd,
        output,
        analysis,
        php_bin=resolved["env"].get("phpBin") or "php",
        docker_compose_path=resolved["env"].get("dockerComposePath"),
    )
    if validation["blocking"] and fix_mode == "ai":
        auto_output = build_phpunit_auto_fix(cwd, analysis)
        if auto_output:
            output = auto_output
            fix_mode = "auto"
            files = output.get("files") or []
            validation = validate_test_fix_output(
                cwd,
                output,
                analysis,
                php_bin=resolved["env"].get("phpBin") or "php",
                docker_compose_path=resolved["env"].get("dockerComposePath"),
            )
    if validation["blocking"]:
        if fix_mode == "auto":
            raise HttpError(
                422,
                "Auto-fix could not resolve the test failure: "
                + "; ".join(validation["blocking"][:3]),
                "test_fix_failed",
                {"errors": validation["blocking"]},
            )
        raise HttpError(
            422,
            "Could not generate a valid fix. "
            + "; ".join(validation["blocking"][:3]),
            "test_fix_failed",
            {"errors": validation["blocking"]},
        )

    diffs = compute_diffs(cwd, files)
    diff_errors = [d for d in diffs if d.get("error")]
    if diff_errors:
        raise HttpError.bad_request(
            "Proposed fix could not be applied: "
            + "; ".join(f"{d['path']}: {d['error']}" for d in diff_errors[:3]),
        )

    git = await get_status(cwd, resolved["project"]["git"]["productionBranch"])
    git["branch"] = run.get("branchName")
    fix_summary = output.get("summary") or (
        "Auto-fixed PHPUnit test mock" if fix_mode == "auto" else "AI agent proposed fixes for the test failure"
    )

    patch_detail(run_id, {
        "output": output,
        "diffs": diffs,
        "applied": False,
        "backups": [],
        "git": git,
        "usage": ai_result["usage"] if ai_result else None,
        "test": {
            **test_report,
            "analysis": analysis,
            "lastFix": {
                "mode": fix_mode,
                "summary": fix_summary,
                "paths": [f["path"] for f in files],
                "previousPaths": (last_fix or {}).get("paths"),
                "at": now_iso(),
                "status": "proposed",
            },
        },
    })

    return {
        "detail": _assemble_detail(run_id),
        "fix": {"mode": fix_mode, "summary": fix_summary, "proposed": True},
    }


@router.post("/runs/{run_id}/complete-deploy")
async def complete_deploy(run_id: str, auth: dict = Depends(get_auth)):
    run = _load_workflow_run(run_id, auth)
    detail = load_detail(run_id)
    wf = extract_workflow(detail)
    if wf["currentStep"] != "deploy":
        raise HttpError.bad_request("Not on the deploy step")
    deploy = detail.get("deploy")
    if not deploy or not deploy.get("ok"):
        raise HttpError.bad_request("Run local deploy successfully before continuing")

    patch_detail(run_id, {
        "currentStep": "commit",
        "completedSteps": mark_completed(wf["completedSteps"], "deploy"),
    })
    runs_repo.update_fields(run_id, {
        "currentStep": "commit",
        "status": "commit_ready",
    })
    return {"detail": _assemble_detail(run_id)}


@router.get("/runs/{run_id}/jira-comment-preview")
async def jira_comment_preview(run_id: str, auth: dict = Depends(get_auth)):
    run = _load_workflow_run(run_id, auth)
    if not run.get("jiraKey"):
        raise HttpError.bad_request("No Jira task linked to this run")
    detail = load_detail(run_id)
    resolved = resolve_environment(run["userId"], run["projectId"])
    comment = format_jira_comment(run, detail, resolved["project"])
    return {"comment": comment}


@router.post("/runs/{run_id}/post-jira-comment")
async def post_jira(run_id: str, body: PostJiraCommentBody, auth: dict = Depends(get_auth)):
    run = _load_workflow_run(run_id, auth)
    if not run.get("jiraKey"):
        raise HttpError.bad_request("No Jira task linked to this run")
    comment = body.comment.strip()
    if not comment:
        raise HttpError.bad_request("Comment cannot be empty")
    detail = load_detail(run_id)
    result = await post_issue_comment(run["projectId"], run["jiraKey"], comment)
    comment_id = str(result.get("id", ""))
    wf = extract_workflow(detail)
    patch_detail(run_id, {
        "jiraCommentPostedAt": now_iso(),
        "jiraCommentId": comment_id or None,
        "jiraCommentText": comment,
        "currentStep": "done",
        "completedSteps": mark_completed(wf["completedSteps"], "jira_comment"),
        "approvalStatus": "done",
    })
    runs_repo.update_fields(run_id, {
        "currentStep": "done",
        "approvalStatus": "done",
        "status": "done",
    })
    return {"detail": _assemble_detail(run_id), "commentId": comment_id}


@router.post("/runs/{run_id}/restore")
async def restore_run(run_id: str, auth: dict = Depends(get_auth)):
    run = _load_workflow_run(run_id, auth)
    return {"detail": _assemble_detail(run_id)}


@router.delete("/runs/{run_id}")
async def delete_run(run_id: str, auth: dict = Depends(get_auth)):
    run = runs_repo.find_by_id(run_id)
    if not run:
        raise HttpError.not_found("Run not found")
    if run["mode"] != "workflow":
        raise HttpError.bad_request("Not a workflow run")
    _assert_project_access(auth, run["projectId"])
    if not _can_delete_run(auth, run):
        raise HttpError.forbidden("You cannot delete this workflow run")
    _cancel_deploy_task(run_id)
    runs_repo.delete_by_id(run_id)
    activities_repo.create({
        "userId": auth["sub"],
        "username": auth["username"],
        "action": "workflow.deleted",
        "resourceType": "run",
        "resourceId": run_id,
        "projectId": run["projectId"],
        "jiraKey": run.get("jiraKey"),
        "summary": f"{auth['username']} deleted workflow history {run.get('jiraKey') or run_id}",
    })
    return {"ok": True}


@router.post("/runs/bulk-delete")
async def bulk_delete_runs(body: BulkDeleteBody, auth: dict = Depends(get_auth)):
    if not body.runIds:
        return {"deleted": 0}

    deletable: list[str] = []
    for run_id in body.runIds:
        run = runs_repo.find_by_id(run_id)
        if not run or run["mode"] != "workflow":
            continue
        try:
            _assert_project_access(auth, run["projectId"])
        except HttpError:
            continue
        if not _can_delete_run(auth, run):
            continue
        deletable.append(run_id)

    for run_id in deletable:
        _cancel_deploy_task(run_id)

    deleted = runs_repo.delete_many(deletable)
    if deleted:
        activities_repo.create({
            "userId": auth["sub"],
            "username": auth["username"],
            "action": "workflow.bulk_deleted",
            "resourceType": "run",
            "resourceId": None,
            "summary": f"{auth['username']} deleted {deleted} workflow history record(s)",
            "metadata": {"runIds": deletable},
        })
    return {"deleted": deleted}


@router.patch("/runs/{run_id}/test-rate")
async def sync_test_rate(run_id: str, auth: dict = Depends(get_auth)):
    """Sync test pass rate from latest test report into workflow state."""
    _load_workflow_run(run_id, auth)
    detail = load_detail(run_id)
    rate = compute_test_pass_rate(detail.get("test"))
    patch_detail(run_id, {"testPassRate": rate})
    return {"detail": _assemble_detail(run_id)}


@router.post("/runs/{run_id}/pause")
async def pause_run(run_id: str, auth: dict = Depends(get_auth)):
    run = _load_workflow_run(run_id, auth)
    if run["status"] in ("done", "cancelled", "failed"):
        raise HttpError.bad_request("Cannot pause a finished run")
    if run["status"] == "paused":
        return {"detail": _assemble_detail(run_id)}
    runs_repo.update_fields(run_id, {"status": "paused"})
    patch_detail(run_id, {"pausedAt": now_iso()})
    activities_repo.create({
        "userId": auth["sub"],
        "username": auth["username"],
        "action": "workflow.paused",
        "resourceType": "run",
        "resourceId": run_id,
        "projectId": run["projectId"],
        "jiraKey": run.get("jiraKey"),
        "summary": f"{auth['username']} paused workflow {run.get('jiraKey') or run_id}",
    })
    return {"detail": _assemble_detail(run_id)}


@router.post("/runs/{run_id}/resume")
async def resume_run(run_id: str, auth: dict = Depends(get_auth)):
    run = _load_workflow_run(run_id, auth)
    if run["status"] != "paused":
        raise HttpError.bad_request("Run is not paused")
    detail = load_detail(run_id)
    wf = extract_workflow(detail)
    step = wf.get("currentStep", "select")
    status_map = {
        "agent": "analyzing",
        "deploy": "deploying",
        "commit": "commit_ready",
        "done": "done",
    }
    runs_repo.update_fields(run_id, {"status": status_map.get(step, "awaiting_review")})
    patch_detail(run_id, {"pausedAt": None, "resumedAt": now_iso()})
    activities_repo.create({
        "userId": auth["sub"],
        "username": auth["username"],
        "action": "workflow.resumed",
        "resourceType": "run",
        "resourceId": run_id,
        "projectId": run["projectId"],
        "jiraKey": run.get("jiraKey"),
        "summary": f"{auth['username']} resumed workflow {run.get('jiraKey') or run_id}",
    })
    return {"detail": _assemble_detail(run_id)}


@router.post("/runs/{run_id}/cancel")
async def cancel_run(run_id: str, auth: dict = Depends(get_auth)):
    run = _load_workflow_run(run_id, auth)
    if run["status"] in ("done", "cancelled"):
        raise HttpError.bad_request("Run is already finished")
    deploy_task = _deploy_tasks.pop(run_id, None)
    if deploy_task and not deploy_task.done():
        deploy_task.cancel()
    detail = load_detail(run_id)
    wf = extract_workflow(detail)
    patch_detail(run_id, {
        "approvalStatus": "failed",
        "cancelledAt": now_iso(),
        "deploy": {**(detail.get("deploy") or {}), "running": False},
    })
    runs_repo.update_fields(run_id, {
        "status": "cancelled",
        "approvalStatus": "failed",
    })
    activities_repo.create({
        "userId": auth["sub"],
        "username": auth["username"],
        "action": "workflow.cancelled",
        "resourceType": "run",
        "resourceId": run_id,
        "projectId": run["projectId"],
        "jiraKey": run.get("jiraKey"),
        "summary": f"{auth['username']} cancelled workflow {run.get('jiraKey') or run_id}",
    })
    return {"detail": _assemble_detail(run_id)}


@router.get("/runs/{run_id}/commits")
async def list_commits(run_id: str, auth: dict = Depends(get_auth), limit: int = 10):
    run = _load_workflow_run(run_id, auth)
    resolved = resolve_environment(run["userId"], run["projectId"])
    branch = run.get("branchName") or (load_detail(run_id).get("git") or {}).get("branch")
    commits = await get_recent_commits(resolved["cwd"], branch, limit=min(limit, 25))
    return {"commits": commits, "branch": branch}


@router.get("/runs/{run_id}/activities")
async def list_run_activities(run_id: str, auth: dict = Depends(get_auth), limit: int = 30):
    _load_workflow_run(run_id, auth)
    activities = activities_repo.list_for_run(run_id, limit=min(limit, 50))
    return {"activities": activities}
