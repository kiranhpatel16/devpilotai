from fastapi import APIRouter, Depends, Query
from middleware.auth import get_auth, is_admin_role
from lib.errors import HttpError
from db.project_roles import project_roles_repo
from db.users import users_repo
from services.jira_service import get_board, get_issue_detail, resolve_jira

router = APIRouter(prefix="/api/projects/{project_id}/jira", tags=["jira"])


def _assert_access(auth: dict, project_id: str):
    if is_admin_role(auth["role"]):
        return
    if not project_roles_repo.get_role(auth["sub"], project_id):
        raise HttpError.forbidden("You are not assigned to this project")


@router.get("/tasks")
async def get_tasks(
    project_id: str,
    scope: str = Query(default="mine"),
    auth: dict = Depends(get_auth),
):
    _assert_access(auth, project_id)

    if scope == "mine":
        me = users_repo.find_by_id(auth["sub"])
        assignee_value = me["jiraAccountId"] if me else None
        if not assignee_value:
            resolved = resolve_jira(project_id)
            return {
                "board": {
                    "configured": bool(resolved),
                    "projectKey": resolved["project"]["jira"]["projectKey"] if resolved else None,
                    "message": (
                        "Set your Jira account to see tasks assigned to you."
                        if resolved
                        else "Jira is not configured for this project. Ask an admin to add credentials."
                    ),
                    "groups": [],
                    "total": 0,
                    "scope": scope,
                    "needsJiraIdentity": True,
                }
            }
        board = await get_board(project_id, {"assigneeValue": assignee_value})
        return {"board": {**board, "scope": scope, "needsJiraIdentity": False}}

    board = await get_board(project_id, {})
    return {"board": {**board, "scope": scope, "needsJiraIdentity": False}}


@router.get("/issues/{key}")
async def get_issue(project_id: str, key: str, auth: dict = Depends(get_auth)):
    _assert_access(auth, project_id)
    return {"issue": await get_issue_detail(project_id, key)}
