"""Usage, credits, and sidebar metadata."""

from fastapi import APIRouter, Depends
import config as cfg
from middleware.auth import get_auth, is_admin_role
from db.ai_settings import run_usage_repo
from db.projects import projects_repo
from db.project_roles import project_roles_repo
from db.users import users_repo
from services.jira_service import get_board

router = APIRouter(prefix="/api/usage", tags=["usage"])


def _tokens_to_credits(tokens: int) -> int:
    return max(0, round(tokens / cfg.TOKENS_PER_CREDIT))


def _user_projects(auth: dict) -> list[dict]:
    if is_admin_role(auth["role"]):
        return projects_repo.list_all()
    roles = project_roles_repo.list_for_user(auth["sub"])
    ids = [r["projectId"] for r in roles]
    return projects_repo.list_by_ids(ids) if ids else []


@router.get("/credits")
async def get_credits(auth: dict = Depends(get_auth)):
    if is_admin_role(auth["role"]):
        totals = run_usage_repo.total_tokens_all()
    else:
        totals = run_usage_repo.total_tokens_for_user(auth["sub"])
    used = _tokens_to_credits(totals["input"] + totals["output"])
    limit = cfg.AI_CREDITS_LIMIT
    return {
        "used": used,
        "limit": limit,
        "percent": round((used / limit) * 100, 1) if limit else 0,
        "tokens": totals,
    }


@router.get("/jira-task-count")
async def jira_task_count(auth: dict = Depends(get_auth)):
    projects = _user_projects(auth)
    me = users_repo.find_by_id(auth["sub"])
    assignee = me.get("jiraAccountId") if me else None
    total = 0
    for p in projects:
        if not p.get("enabled", True):
            continue
        try:
            filters = {"assigneeValue": assignee} if assignee else {}
            board = await get_board(p["id"], filters)
            if board.get("configured"):
                total += board.get("total", 0)
        except Exception:
            continue
    return {"count": total}
