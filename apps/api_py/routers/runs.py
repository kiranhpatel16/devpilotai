from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
import re as re_module
from lib.errors import HttpError
from middleware.auth import get_auth, is_admin_role, can_write_on_project
from db.runs import runs_repo
from db.project_roles import project_roles_repo
from db.activities import activities_repo
from db.ai_settings import run_usage_repo
from database import now_iso
from services.environment import resolve_environment
from services.jira_service import get_issue_detail
from services.ai_service import run_ai
from services.repo_context import enrich_repo_context
from services.git_service import (
    apply_changes, capture_backups, commit_all, compute_diffs,
    create_branch, get_status, push_branch, revert_changes,
    merge_refined_files, normalize_file_changes,
)
from services.pr_service import create_pull_request
from services.testing_service import run_tests
from services.agent_output_validator import (
    validate_agent_output,
    validate_deploy_fix_output,
    validate_test_fix_output,
    lint_deploy_fix_php_syntax,
    quality_error_message,
)
from services.run_detail import load_detail, patch_detail
from services.task_plan_storage import save_task_plan
from services.ai_providers.registry import enabled_provider_info

router = APIRouter(prefix="/api/runs", tags=["runs"])


class CreateRunBody(BaseModel):
    projectId: str
    jiraKey: Optional[str] = None
    mode: str
    provider: Optional[str] = None
    model: Optional[str] = None
    userInstructions: Optional[str] = None
    branchName: Optional[str] = None


class ApplyBody(BaseModel):
    paths: Optional[list[str]] = None


class RefineBody(BaseModel):
    instructions: str


class CommitBody(BaseModel):
    message: str


def _sanitize_branch(name: str) -> str:
    return re_module.sub(r"[^A-Za-z0-9._\-/]", "-", name.strip())


def _assert_write_access(auth: dict, project_id: str, agent_mode: bool):
    if is_admin_role(auth["role"]):
        return
    role = project_roles_repo.get_role(auth["sub"], project_id)
    if not role:
        raise HttpError.forbidden("You are not assigned to this project")
    if agent_mode and not can_write_on_project(role):
        raise HttpError.forbidden("Your project role cannot run Agent mode")


def _load_owned_run(run_id: str, auth: dict) -> dict:
    run = runs_repo.find_by_id(run_id)
    if not run:
        raise HttpError.not_found("Run not found")
    if run["userId"] != auth["sub"] and not is_admin_role(auth["role"]):
        raise HttpError.forbidden()
    return run


def _assemble_detail(run_id: str) -> dict:
    run = runs_repo.find_by_id(run_id)
    detail = load_detail(run_id)
    wf = None
    if run and run.get("mode") == "workflow":
        from services.workflow import extract_workflow
        wf = extract_workflow(detail)
    return {
        "run": run,
        "output": detail["output"],
        "diffs": detail["diffs"],
        "applied": detail["applied"],
        "canRevert": detail["applied"] and len(detail["backups"]) > 0 and not (detail.get("git") or {}).get("committed"),
        "test": detail["test"],
        "deploy": detail.get("deploy"),
        "git": detail["git"],
        "usage": detail["usage"],
        "error": runs_repo.get_error(run_id),
        "planFilePath": detail.get("planFilePath"),
        "workflow": wf,
    }


def _pick_provider(requested: str | None) -> str:
    if requested:
        return requested
    enabled = enabled_provider_info()
    if not enabled:
        raise HttpError.bad_request("No AI provider is enabled. Configure one in Admin → AI Providers.")
    return enabled[0]["id"]


@router.get("")
async def list_runs(auth: dict = Depends(get_auth)):
    return {"runs": runs_repo.list_for_user(auth["sub"])}


@router.post("", status_code=201)
async def create_run(body: CreateRunBody, auth: dict = Depends(get_auth)):
    if body.mode not in ("agent", "plan", "debug", "ask"):
        raise HttpError.bad_request(f"Invalid mode: {body.mode}")

    agent_mode = body.mode == "agent"
    _assert_write_access(auth, body.projectId, agent_mode)
    resolved = resolve_environment(auth["sub"], body.projectId)
    provider = _pick_provider(body.provider)

    desired_branch = (body.branchName or "").strip() or (body.jiraKey or "").strip()
    branch_name = _sanitize_branch(desired_branch) if agent_mode and desired_branch else None

    run = runs_repo.create({
        "projectId": body.projectId,
        "userId": auth["sub"],
        "jiraKey": body.jiraKey,
        "mode": body.mode,
        "provider": provider,
        "model": body.model,
        "userInstructions": body.userInstructions,
        "branchName": branch_name,
        "status": "branching" if agent_mode else "analyzing",
    })

    activities_repo.create({
        "userId": auth["sub"], "username": auth["username"],
        "action": "run.started", "resourceType": "run",
        "resourceId": run["id"], "projectId": body.projectId,
        "projectName": resolved["project"]["name"],
        "jiraKey": body.jiraKey,
        "summary": f"{auth['username']} started {body.mode} run{f' for {body.jiraKey}' if body.jiraKey else ''}",
        "metadata": {"mode": body.mode, "provider": provider},
    })

    try:
        jira = None
        if body.jiraKey:
            try:
                jira = await get_issue_detail(body.projectId, body.jiraKey)
            except Exception:
                jira = None

        if agent_mode and branch_name:
            await create_branch(resolved["cwd"], branch_name, resolved["project"]["git"]["productionBranch"])
            runs_repo.update_status(run["id"], "analyzing")

        task_text = " ".join(filter(None, [
            jira["summary"] if jira else None,
            jira.get("description") if jira else None,
            body.userInstructions,
            branch_name,
        ]))
        repo = enrich_repo_context(
            resolved["cwd"], task_text, resolved["project"].get("frontendTheme"),
        )

        ai_result = await run_ai(provider, body.model, {
            "project": resolved["project"],
            "cwd": resolved["cwd"],
            "frontendUrl": resolved["frontendUrl"],
            "backendUrl": resolved["backendUrl"],
            "mode": body.mode,
            "jira": jira,
            "jiraKey": body.jiraKey,
            "userInstructions": body.userInstructions,
            "activeTheme": resolved["project"].get("frontendTheme"),
            "repoOverview": repo["overview"],
            "fileExcerpts": repo["excerpts"],
        })

        run_usage_repo.record(run["id"], ai_result["usage"])
        output = ai_result["output"]
        diffs = compute_diffs(resolved["cwd"], output["files"]) if agent_mode and output["files"] else []
        git = await get_status(resolved["cwd"], resolved["project"]["git"]["productionBranch"]) if agent_mode else None
        if git:
            git["branch"] = branch_name

        plan_file_path = None
        if body.mode == "plan" and output.get("text"):
            task_key = (body.jiraKey or "").strip() or run["id"]
            plan_file_path = save_task_plan(
                project_slug=resolved["project"]["slug"],
                project_name=resolved["project"]["name"],
                task_key=task_key,
                plan_text=output["text"],
            )

        patch_detail(
            run["id"],
            {
                "output": output,
                "diffs": diffs,
                "git": git,
                "usage": ai_result["usage"],
                "applied": False,
                "planFilePath": plan_file_path,
            },
        )
        runs_repo.update_status(run["id"], "awaiting_review" if agent_mode else "done", output.get("summary") or None)

        return {"detail": _assemble_detail(run["id"])}

    except Exception as err:
        message = str(err)
        runs_repo.set_error(run["id"], message)
        runs_repo.update_status(run["id"], "failed")
        activities_repo.create({
            "userId": auth["sub"], "username": auth["username"],
            "action": "run.failed", "resourceType": "run",
            "resourceId": run["id"], "projectId": body.projectId,
            "projectName": resolved["project"]["name"],
            "summary": f"Run {run['id']} failed: {message}",
        })
        raise


@router.get("/{run_id}")
async def get_run(run_id: str, auth: dict = Depends(get_auth)):
    _load_owned_run(run_id, auth)
    return {"detail": _assemble_detail(run_id)}


@router.post("/{run_id}/apply")
async def apply_run(run_id: str, body: ApplyBody = ApplyBody(), auth: dict = Depends(get_auth)):
    run = _load_owned_run(run_id, auth)
    if run["mode"] not in ("agent", "workflow"):
        raise HttpError.bad_request("Only agent/workflow runs can be applied")
    detail = load_detail(run_id)
    if not detail["output"] or not detail["output"].get("files"):
        raise HttpError.bad_request("No proposed changes to apply")

    resolved = resolve_environment(run["userId"], run["projectId"])
    deploy = detail.get("deploy")
    prior_test = detail.get("test")
    is_deploy_fix = (
        run["mode"] == "workflow"
        and deploy
        and (deploy.get("lastFix") or {}).get("status") == "proposed"
    )
    is_test_fix = (
        run["mode"] == "workflow"
        and prior_test
        and (prior_test.get("lastFix") or {}).get("status") == "proposed"
        and not is_deploy_fix
    )
    if is_deploy_fix:
        validation_errors = validate_deploy_fix_output(
            resolved["cwd"],
            detail["output"],
            deploy.get("analysis") or {},
            php_bin=resolved["env"].get("phpBin") or "php",
            docker_compose_path=resolved["env"].get("dockerComposePath"),
        )
    elif is_test_fix:
        validation_errors = validate_test_fix_output(
            resolved["cwd"],
            detail["output"],
            (prior_test or {}).get("analysis") or {},
            php_bin=resolved["env"].get("phpBin") or "php",
            docker_compose_path=resolved["env"].get("dockerComposePath"),
        )
    else:
        validation_errors = validate_agent_output(resolved["cwd"], detail["output"])
    if validation_errors["blocking"]:
        message = (
            "Cannot apply deploy fix — the proposal does not resolve the error. Regenerate fix. "
            if is_deploy_fix
            else (
                "Cannot apply test fix — the proposal is incomplete. Regenerate fix. "
                if is_test_fix
                else "Cannot apply incomplete/stub code. Re-run the agent to generate full implementations. "
            )
        )
        raise HttpError(
            422,
            message + "; ".join(validation_errors["blocking"][:3]),
            "agent_stub_output",
            {"errors": validation_errors["blocking"], "warnings": validation_errors["warnings"]},
        )

    applied_paths = body.paths or [f["path"] for f in detail["output"]["files"]]
    if is_deploy_fix:
        php_bin = resolved["env"].get("phpBin") or "php"
        syntax_errors = lint_deploy_fix_php_syntax(
            resolved["cwd"], php_bin, detail["output"]["files"], applied_paths,
            docker_compose_path=resolved["env"].get("dockerComposePath"),
        )
        if syntax_errors:
            if deploy:
                patch_detail(run_id, {
                    "deploy": {
                        **deploy,
                        "lastFix": {
                            **(deploy.get("lastFix") or {}),
                            "applyError": "; ".join(syntax_errors[:3]),
                        },
                    },
                })
            raise HttpError(
                422,
                "Cannot apply deploy fix — PHP syntax check failed. Regenerate fix. "
                + "; ".join(syntax_errors[:3]),
                "deploy_fix_syntax_error",
                {"errors": syntax_errors},
            )

    backups = capture_backups(resolved["cwd"], detail["output"]["files"], body.paths)
    apply_changes(resolved["cwd"], detail["output"]["files"], body.paths)
    git = await get_status(resolved["cwd"], resolved["project"]["git"]["productionBranch"])
    git["branch"] = run["branchName"]

    test_report = await run_tests(
        resolved["cwd"], applied_paths, resolved["env"].get("phpBin") or "php",
    )

    patch: dict = {"applied": True, "git": git, "backups": backups, "test": test_report}
    if is_deploy_fix and deploy:
        patch["deploy"] = {
            **deploy,
            "lastFix": {
                **(deploy.get("lastFix") or {}),
                "status": "applied",
                "appliedAt": now_iso(),
            },
        }
    if is_test_fix and prior_test:
        last_fix_patch = {
            **(prior_test.get("lastFix") or {}),
            "status": "applied" if test_report.get("ok") else "failed",
            "appliedAt": now_iso(),
        }
        if not test_report.get("ok"):
            last_fix_patch["failedAt"] = now_iso()
        patch["test"] = {
            **test_report,
            "lastFix": last_fix_patch,
        }
    patch_detail(run_id, patch)
    runs_repo.update_status(run_id, "testing")
    activities_repo.create({
        "userId": auth["sub"], "username": auth["username"],
        "action": "run.applied", "resourceType": "run",
        "resourceId": run_id, "projectId": run["projectId"],
        "jiraKey": run["jiraKey"],
        "summary": f"{auth['username']} applied changes for {run['jiraKey'] or run_id}",
    })
    return {"detail": _assemble_detail(run_id)}


@router.post("/{run_id}/refine")
async def refine_run(run_id: str, body: RefineBody, auth: dict = Depends(get_auth)):
    run = _load_owned_run(run_id, auth)
    if run["mode"] not in ("agent", "workflow"):
        raise HttpError.bad_request("Only agent/workflow runs can be refined")
    detail = load_detail(run_id)
    if not detail["output"]:
        raise HttpError.bad_request("No existing proposal to refine")
    if detail["applied"]:
        raise HttpError.bad_request("Revert the applied changes before refining the proposal")

    resolved = resolve_environment(run["userId"], run["projectId"])
    provider = _pick_provider(run.get("provider"))

    try:
        prior_output = detail["output"]
        prior_blocking = (
            prior_output.get("validationErrors")
            or validate_agent_output(resolved["cwd"], prior_output)["blocking"]
        )
        refine_instructions = body.instructions.strip()
        if prior_blocking:
            issue_list = "\n".join(f"- {err}" for err in prior_blocking)
            refine_instructions = (
                f"{refine_instructions}\n\n"
                "Fix these quality issues in the current proposal (replace stub/placeholder code "
                "with full implementations — do not drop unrelated files):\n"
                f"{issue_list}"
            ).strip()

        task_text = " ".join(filter(None, [
            run["jiraKey"],
            run["userInstructions"],
            prior_output.get("summary"),
            body.instructions,
            run["branchName"],
            *prior_blocking,
        ]))
        repo = enrich_repo_context(
            resolved["cwd"],
            task_text,
            resolved["project"].get("frontendTheme"),
            plan_markdown=detail.get("planMarkdown"),
            prior_output=prior_output,
        )
        ai_result = await run_ai(provider, run.get("model"), {
            "project": resolved["project"],
            "cwd": resolved["cwd"],
            "frontendUrl": resolved["frontendUrl"],
            "backendUrl": resolved["backendUrl"],
            "mode": "agent",
            "jira": None,
            "jiraKey": run["jiraKey"],
            "userInstructions": run["userInstructions"],
            "activeTheme": resolved["project"].get("frontendTheme"),
            "repoOverview": repo["overview"],
            "fileExcerpts": repo["excerpts"],
            "priorOutput": prior_output,
            "refineInstructions": refine_instructions,
            "validationErrors": prior_blocking,
            "approvedPlanMarkdown": detail.get("planMarkdown"),
        })
        run_usage_repo.record(run_id, ai_result["usage"])
        output = ai_result["output"]
        output["files"] = merge_refined_files(
            prior_output.get("files") or [],
            output.get("files") or [],
        )
        output["files"] = normalize_file_changes(resolved["cwd"], output["files"])
        post_merge_validation = validate_agent_output(resolved["cwd"], output)
        blocking = post_merge_validation["blocking"]
        warnings = post_merge_validation["warnings"]
        if blocking:
            output["validationErrors"] = blocking
        else:
            output.pop("validationErrors", None)
        if warnings:
            output["validationWarnings"] = warnings
        else:
            output.pop("validationWarnings", None)
        diffs = compute_diffs(resolved["cwd"], output["files"]) if output["files"] else []
        patch_detail(run_id, {"output": output, "diffs": diffs, "usage": ai_result["usage"], "applied": False, "backups": [], "test": None})
        runs_repo.set_error(run_id, quality_error_message(blocking))
        runs_repo.update_status(run_id, "awaiting_review", output.get("summary") or None)
        return {"detail": _assemble_detail(run_id)}
    except Exception as err:
        runs_repo.set_error(run_id, str(err))
        raise


@router.post("/{run_id}/revert")
async def revert_run(run_id: str, auth: dict = Depends(get_auth)):
    run = _load_owned_run(run_id, auth)
    detail = load_detail(run_id)
    if not detail["applied"] or not detail["backups"]:
        raise HttpError.bad_request("Nothing to revert")
    if (detail.get("git") or {}).get("committed"):
        raise HttpError.bad_request("Changes were already committed. Use `git revert`/`git reset` in the project to undo a commit.")

    resolved = resolve_environment(run["userId"], run["projectId"])
    revert_changes(resolved["cwd"], detail["backups"])
    git = await get_status(resolved["cwd"], resolved["project"]["git"]["productionBranch"])
    git["branch"] = run["branchName"]

    patch_detail(run_id, {"applied": False, "backups": [], "git": git, "test": None})
    runs_repo.update_status(run_id, "awaiting_review")
    activities_repo.create({
        "userId": auth["sub"], "username": auth["username"],
        "action": "run.rejected", "resourceType": "run",
        "resourceId": run_id, "projectId": run["projectId"],
        "jiraKey": run["jiraKey"],
        "summary": f"{auth['username']} reverted applied changes for {run['jiraKey'] or run_id}",
    })
    return {"detail": _assemble_detail(run_id)}


@router.post("/{run_id}/test")
async def test_run(run_id: str, auth: dict = Depends(get_auth)):
    run = _load_owned_run(run_id, auth)
    resolved = resolve_environment(run["userId"], run["projectId"])
    detail = load_detail(run_id)
    changed = [f["path"] for f in (detail["output"]["files"] if detail["output"] else [])]
    report = await run_tests(resolved["cwd"], changed, resolved["env"].get("phpBin") or "php")
    patch_detail(run_id, {"test": report})
    run = runs_repo.find_by_id(run_id)
    if run and run.get("mode") == "workflow":
        from services.workflow import compute_test_pass_rate
        patch_detail(run_id, {"testPassRate": compute_test_pass_rate(report)})
    if report["ok"]:
        runs_repo.update_status(run_id, "commit_ready")
    return {"detail": _assemble_detail(run_id)}


@router.post("/{run_id}/commit")
async def commit_run(run_id: str, body: CommitBody, auth: dict = Depends(get_auth)):
    run = _load_owned_run(run_id, auth)
    resolved = resolve_environment(run["userId"], run["projectId"])
    hexsha = await commit_all(resolved["cwd"], body.message)
    git = await get_status(resolved["cwd"], resolved["project"]["git"]["productionBranch"])
    git["branch"] = run["branchName"]
    git["committed"] = True
    git["commitMessage"] = body.message
    git["lastCommitSha"] = hexsha
    patch_detail(run_id, {"git": git})
    runs_repo.update_status(run_id, "pushing")
    activities_repo.create({
        "userId": auth["sub"], "username": auth["username"],
        "action": "run.committed", "resourceType": "run",
        "resourceId": run_id, "projectId": run["projectId"],
        "jiraKey": run["jiraKey"],
        "summary": f"{auth['username']} committed {run['jiraKey'] or run_id}",
    })
    return {"detail": _assemble_detail(run_id)}


@router.post("/{run_id}/push")
async def push_run(run_id: str, auth: dict = Depends(get_auth)):
    run = _load_owned_run(run_id, auth)
    if not run["branchName"]:
        raise HttpError.bad_request("Run has no branch to push")
    resolved = resolve_environment(run["userId"], run["projectId"])
    await push_branch(resolved["cwd"], run["branchName"], resolved["project"]["git"]["remote"])
    detail = load_detail(run_id)
    git = detail.get("git") or await get_status(resolved["cwd"], resolved["project"]["git"]["productionBranch"])
    git["pushed"] = True
    patch_detail(run_id, {"git": git})
    runs_repo.update_status(run_id, "pr_creating")
    activities_repo.create({
        "userId": auth["sub"], "username": auth["username"],
        "action": "run.pushed", "resourceType": "run",
        "resourceId": run_id, "projectId": run["projectId"],
        "jiraKey": run["jiraKey"],
        "summary": f"{auth['username']} pushed {run['branchName']}",
    })
    return {"detail": _assemble_detail(run_id)}


@router.post("/{run_id}/pr")
async def create_pr(run_id: str, auth: dict = Depends(get_auth)):
    run = _load_owned_run(run_id, auth)
    if not run["branchName"]:
        raise HttpError.bad_request("Run has no branch")
    resolved = resolve_environment(run["userId"], run["projectId"])
    detail = load_detail(run_id)

    title = f"[{run['jiraKey'] or run['branchName']}] {detail.get('output', {}).get('summary', '') or 'CPWork change'}"
    body_parts = []
    if run["jiraKey"] and resolved["project"]["jira"].get("baseUrl"):
        base = resolved["project"]["jira"]["baseUrl"].rstrip("/")
        body_parts.append(f"## Jira\n[{run['jiraKey']}]({base}/browse/{run['jiraKey']})")
    if detail.get("output", {}).get("summary"):
        body_parts.append(f"## Summary\n{detail['output']['summary']}")
    if detail.get("output", {}).get("files"):
        file_lines = "\n".join(f"- {f['action']}: {f['path']}" for f in detail["output"]["files"])
        body_parts.append(f"## Files\n{file_lines}")
    if detail.get("test"):
        step_lines = "\n".join(
            f"- {s['label']}: {'skipped' if s['skipped'] else ('pass' if s['ok'] else 'FAIL')}"
            for s in detail["test"]["steps"]
        )
        body_parts.append(f"## Tests\n{step_lines}")
    if detail.get("output", {}).get("manualTestChecklist"):
        checklist = "\n".join(f"- [ ] {c}" for c in detail["output"]["manualTestChecklist"])
        body_parts.append(f"## Manual checklist\n{checklist}")

    pr_body = "\n\n".join(body_parts)
    url = await create_pull_request(
        run["projectId"],
        resolved["cwd"],
        resolved["project"]["git"]["prTargetBranch"],
        run["branchName"],
        title,
        pr_body,
    )

    git = detail.get("git") or await get_status(resolved["cwd"], resolved["project"]["git"]["productionBranch"])
    git["prUrl"] = url
    patch_detail(run_id, {"git": git})
    runs_repo.update_status(run_id, "done")
    activities_repo.create({
        "userId": auth["sub"], "username": auth["username"],
        "action": "run.pr_created", "resourceType": "run",
        "resourceId": run_id, "projectId": run["projectId"],
        "jiraKey": run["jiraKey"],
        "summary": f"{auth['username']} opened staging PR for {run['jiraKey'] or run['branchName']}",
        "metadata": {"url": url},
    })
    return {"detail": _assemble_detail(run_id), "prUrl": url}
