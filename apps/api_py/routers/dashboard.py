"""Dashboard summary aggregator."""

import time
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends
import config as cfg
from middleware.auth import get_auth, is_admin_role
from db.projects import projects_repo
from db.project_roles import project_roles_repo
from db.runs import runs_repo
from db.activities import activities_repo
from db.ai_settings import run_usage_repo
from services.run_detail import load_detail
from services.jira_service import get_board
from services.agents.registry import AGENT_REGISTRY, agent_for_step
from db.users import users_repo

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

_cache: dict = {"data": None, "expires": 0.0}
CACHE_TTL = 60


def _tokens_to_credits(tokens: int) -> int:
    return max(0, round(tokens / cfg.TOKENS_PER_CREDIT))


def _user_projects(auth: dict) -> list[dict]:
    if is_admin_role(auth["role"]):
        return projects_repo.list_all()
    roles = project_roles_repo.list_for_user(auth["sub"])
    ids = [r["projectId"] for r in roles]
    return projects_repo.list_by_ids(ids) if ids else []


def _count_by_category(tasks: list[dict]) -> dict:
    counts = {
        "open": 0,
        "inProgress": 0,
        "codeReview": 0,
        "prReady": 0,
        "deployReady": 0,
        "blocked": 0,
        "done": 0,
    }
    for t in tasks:
        cat = (t.get("statusCategory") or "").lower()
        status = (t.get("status") or "").lower()
        if cat == "done":
            counts["done"] += 1
        elif "block" in status:
            counts["blocked"] += 1
        elif cat == "in progress":
            counts["inProgress"] += 1
        elif "review" in status or "code review" in status:
            counts["codeReview"] += 1
        elif "pr" in status or "ready" in status:
            counts["prReady"] += 1
        elif "deploy" in status:
            counts["deployReady"] += 1
        else:
            counts["open"] += 1
    return counts


async def _aggregate_jira(projects: list[dict], auth: dict) -> dict:
    all_tasks: list[dict] = []
    by_project: list[dict] = []
    me = users_repo.find_by_id(auth["sub"])
    assignee = me.get("jiraAccountId") if me else None

    for p in projects:
        if not p.get("enabled", True):
            continue
        try:
            filters = {}
            if assignee:
                filters["assigneeValue"] = assignee
            board = await get_board(p["id"], filters)
            if not board.get("configured"):
                continue
            tasks = []
            for g in board.get("groups", []):
                tasks.extend(g.get("tasks", []))
            all_tasks.extend(tasks)
            by_project.append({
                "projectId": p["id"],
                "projectName": p["name"],
                "count": len(tasks),
            })
        except Exception:
            continue

    status_counts = _count_by_category(all_tasks)
    recent = sorted(all_tasks, key=lambda t: t.get("updated") or "", reverse=True)[:8]

    return {
        "taskCounts": status_counts,
        "totalTasks": len(all_tasks),
        "tasksByProject": by_project,
        "recentTasks": recent,
    }


def _workflow_stats(auth: dict, projects: list[dict]) -> dict:
    project_ids = {p["id"] for p in projects}
    if is_admin_role(auth["role"]):
        from database import get_db
        rows = get_db().execute(
            "SELECT id, project_id, user_id, mode, status FROM runs WHERE mode='workflow' ORDER BY created_at DESC LIMIT 200"
        ).fetchall()
        runs = [
            {"id": r["id"], "projectId": r["project_id"], "userId": r["user_id"], "mode": r["mode"], "status": r["status"]}
            for r in rows
        ]
    else:
        runs = runs_repo.list_for_user(auth["sub"], limit=200)

    workflow_runs = [r for r in runs if r.get("mode") == "workflow" and r.get("projectId") in project_ids]

    ai_completed = sum(1 for r in workflow_runs if r.get("status") == "done")
    pr_ready = sum(1 for r in workflow_runs if r.get("status") in ("commit_ready", "pushing", "pr_creating"))

    files_modified = 0
    tests_generated = 0
    for r in workflow_runs:
        detail = load_detail(r["id"])
        output = detail.get("output") or {}
        files_modified += len(output.get("files") or [])
        test = detail.get("test") or {}
        if test.get("steps"):
            tests_generated += 1

    if is_admin_role(auth["role"]):
        totals = run_usage_repo.total_tokens_all()
    else:
        totals = run_usage_repo.total_tokens_for_user(auth["sub"])
    credits_used = _tokens_to_credits(totals["input"] + totals["output"])

    return {
        "aiCompleted": ai_completed,
        "prReady": pr_ready,
        "filesModified": files_modified,
        "testsGenerated": tests_generated,
        "hoursSaved": round(files_modified * 0.15 + tests_generated * 0.25, 1),
        "aiCreditsUsed": credits_used,
        "aiCreditsLimit": cfg.AI_CREDITS_LIMIT,
    }


def _build_ai_activity() -> list[dict]:
    day_names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    rows = run_usage_repo.daily_activity(7)
    by_day = {r["day"]: r for r in rows}
    result = []
    now = datetime.now(timezone.utc)
    for i in range(6, -1, -1):
        d = (now - timedelta(days=i)).date().isoformat()
        row = by_day.get(d, {})
        tokens = (row.get("inp") or 0) + (row.get("outp") or 0)
        result.append({
            "day": day_names[(now - timedelta(days=i)).weekday()],
            "files": max(1, row.get("runs", 0) * 3) if row else 0,
            "loc": tokens // 2,
            "tests": row.get("runs", 0),
            "prs": max(0, row.get("runs", 0) // 2),
            "commits": row.get("runs", 0),
        })
    return result


def _agent_status(auth: dict) -> list[dict]:
    active_runs = runs_repo.list_for_user(auth["sub"], limit=30)
    busy: dict[str, str] = {}
    for run in active_runs:
        if run.get("status") in ("analyzing", "branching", "awaiting_review", "testing", "deploying", "paused"):
            step = run.get("currentStep") or "agent"
            aid = agent_for_step(step) or "developer"
            busy[aid] = run.get("jiraKey") or run.get("summary") or run["id"]

    agents = []
    for agent_id, cfg in AGENT_REGISTRY.items():
        task = busy.get(agent_id)
        agents.append({
            "id": agent_id,
            "label": cfg["label"],
            "status": "busy" if task else "online",
            "task": task,
        })
    return agents


@router.get("/summary")
async def dashboard_summary(auth: dict = Depends(get_auth)):
    now = time.time()
    if _cache["data"] and _cache["expires"] > now:
        return _cache["data"]

    projects = _user_projects(auth)
    jira_data = await _aggregate_jira(projects, auth)
    workflow_data = _workflow_stats(auth, projects)

    project_ids = [p["id"] for p in projects]
    if is_admin_role(auth["role"]):
        activities = activities_repo.recent(10)
    else:
        activities = activities_repo.list_for_projects(project_ids, 10)

    pipeline = {
        "todo": jira_data["taskCounts"]["open"],
        "inProgress": jira_data["taskCounts"]["inProgress"],
        "codeReview": jira_data["taskCounts"]["codeReview"],
        "prReady": jira_data["taskCounts"]["prReady"] + workflow_data["prReady"],
        "testing": jira_data["taskCounts"].get("deployReady", 0),
        "deployed": jira_data["taskCounts"]["done"],
        "blocked": jira_data["taskCounts"]["blocked"],
    }

    result = {
        "taskCounts": jira_data["taskCounts"],
        "totalTasks": jira_data["totalTasks"],
        "tasksByProject": jira_data["tasksByProject"],
        "recentTasks": jira_data["recentTasks"],
        "productivity": workflow_data,
        "pipeline": pipeline,
        "aiActivity": _build_ai_activity(),
        "activities": activities,
        "agents": _agent_status(auth),
    }

    _cache["data"] = result
    _cache["expires"] = now + CACHE_TTL
    return result
