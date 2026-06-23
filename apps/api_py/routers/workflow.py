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
from services.environment import resolve_environment
from services.jira_service import get_issue_detail, post_issue_comment
from services.ai_service import run_ai
from services.repo_context import build_repo_context
from services.git_service import compute_diffs, create_branch, get_status
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
from services.deploy_service import run_local_deploy
from database import now_iso

router = APIRouter(prefix="/api/workflow", tags=["workflow"])

_deploy_tasks: dict[str, asyncio.Task] = {}


class StartWorkflowBody(BaseModel):
    projectId: str
    jiraKey: Optional[str] = None
    customTitle: Optional[str] = None


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
        jira.get("description") if jira else None,
        run.get("userInstructions"),
        run.get("branchName"),
    ]))
    repo = build_repo_context(resolved["cwd"], task_text, resolved["project"].get("frontendTheme"))
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


@router.get("/history")
async def workflow_history(projectId: str, auth: dict = Depends(get_auth)):
    _assert_project_access(auth, projectId)
    runs = runs_repo.list_workflow_for_project(projectId)
    rows = []
    for run in runs:
        detail = load_detail(run["id"])
        wf = extract_workflow(detail)
        rows.append({
            "runId": run["id"],
            "jiraKey": run.get("jiraKey"),
            "branchName": run.get("branchName"),
            "provider": run.get("provider"),
            "model": run.get("model"),
            "approvalStatus": wf["approvalStatus"],
            "testPassRate": wf.get("testPassRate"),
            "currentStep": wf["currentStep"],
            "summary": run.get("summary"),
            "createdAt": run["createdAt"],
            "updatedAt": run["updatedAt"],
        })
    return {"rows": rows}


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
    detail["customTitle"] = (body.customTitle or "").strip() or None
    detail["currentStep"] = "branch"
    detail["completedSteps"] = mark_completed([], "select")
    save_detail(run["id"], detail)

    activities_repo.create({
        "userId": auth["sub"], "username": auth["username"],
        "action": "workflow.started", "resourceType": "run",
        "resourceId": run["id"], "projectId": body.projectId,
        "projectName": resolved["project"]["name"],
        "jiraKey": jira_key,
        "summary": f"{auth['username']} started workflow{f' for {jira_key}' if jira_key else ''}",
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
        runs_repo.set_error(run_id, None)
        return {"detail": _assemble_detail(run_id)}
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

    patch_detail(run_id, {
        "deploy": {
            "ranAt": now_iso(),
            "ok": False,
            "running": True,
            "steps": [],
        },
    })
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
            )
            patch_detail(run_id, {"deploy": report})
            runs_repo.update_fields(run_id, {
                "status": "deploy_ready" if report["ok"] else "deploy_failed",
            })
        except Exception as exc:
            failed = {
                "ranAt": now_iso(),
                "ok": False,
                "running": False,
                "steps": load_detail(run_id).get("deploy", {}).get("steps", []),
                "error": str(exc),
            }
            patch_detail(run_id, {"deploy": failed})
            runs_repo.update_fields(run_id, {"status": "deploy_failed"})
        finally:
            _deploy_tasks.pop(run_id, None)

    _deploy_tasks[run_id] = asyncio.create_task(job())
    return {"detail": _assemble_detail(run_id)}


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


@router.patch("/runs/{run_id}/test-rate")
async def sync_test_rate(run_id: str, auth: dict = Depends(get_auth)):
    """Sync test pass rate from latest test report into workflow state."""
    _load_workflow_run(run_id, auth)
    detail = load_detail(run_id)
    rate = compute_test_pass_rate(detail.get("test"))
    patch_detail(run_id, {"testPassRate": rate})
    return {"detail": _assemble_detail(run_id)}
