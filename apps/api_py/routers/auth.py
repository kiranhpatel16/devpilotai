from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Request, Response, Depends
from pydantic import BaseModel
from typing import Optional
from lib.errors import HttpError
from lib.jwt_utils import sign_token, AUTH_COOKIE, EXPIRES_SECONDS
from lib.password import verify_password
from middleware.auth import get_auth
from db.users import users_repo, to_public_user
from db.project_roles import project_roles_repo
from db.activities import activities_repo
import config as cfg

router = APIRouter(prefix="/api/auth", tags=["auth"])

MAX_FAILED = 5
LOCK_MINUTES = 15


class LoginBody(BaseModel):
    username: str
    password: str


class JiraAccountBody(BaseModel):
    jiraAccountId: Optional[str] = None


class JiraAccountDetectBody(BaseModel):
    projectId: Optional[str] = None


def build_session(user_id: str) -> dict:
    user = users_repo.find_by_id(user_id)
    if not user:
        raise HttpError.unauthorized()
    return {
        "user": to_public_user(user),
        "projectRoles": project_roles_repo.list_for_user(user_id),
    }


async def authenticate(username: str, password: str) -> dict:
    user = users_repo.find_by_username(username)
    if not user:
        raise HttpError.unauthorized("Invalid username or password")

    if user["status"] == "disabled":
        raise HttpError.forbidden("Account is disabled")

    if user.get("lockedUntil"):
        locked_until = datetime.fromisoformat(user["lockedUntil"].replace("Z", "+00:00"))
        if locked_until > datetime.now(timezone.utc):
            raise HttpError.forbidden("Account is temporarily locked. Try again later.")

    ok = verify_password(password, user["passwordHash"])
    if not ok:
        attempts = user["failedLoginAttempts"] + 1
        locked_until = None
        if attempts >= MAX_FAILED:
            locked_until = (datetime.now(timezone.utc) + timedelta(minutes=LOCK_MINUTES)).isoformat()
        users_repo.record_login_failure(user["id"], attempts, locked_until)
        if locked_until:
            raise HttpError.forbidden("Too many failed attempts. Account locked for 15 minutes.")
        raise HttpError.unauthorized("Invalid username or password")

    users_repo.record_login_success(user["id"])
    return to_public_user(user)


@router.post("/login")
async def login(body: LoginBody, request: Request, response: Response):
    user = await authenticate(body.username, body.password)
    token = sign_token(user["id"], user["username"], user["globalRole"])

    response.set_cookie(
        key=AUTH_COOKIE,
        value=token,
        httponly=True,
        samesite="lax",
        secure=cfg.IS_PROD,
        max_age=EXPIRES_SECONDS,
    )

    activities_repo.create({
        "userId": user["id"],
        "username": user["username"],
        "action": "auth.login",
        "summary": f"{user['username']} logged in",
        "ipAddress": request.client.host if request.client else None,
    })

    session = build_session(user["id"])
    return {**session, "token": token}


@router.post("/logout")
async def logout(response: Response, request: Request, auth: dict = Depends(get_auth)):
    response.delete_cookie(AUTH_COOKIE)
    activities_repo.create({
        "userId": auth["sub"],
        "username": auth["username"],
        "action": "auth.logout",
        "summary": f"{auth['username']} logged out",
        "ipAddress": request.client.host if request.client else None,
    })
    return {"ok": True}


@router.get("/me")
async def me(auth: dict = Depends(get_auth)):
    return build_session(auth["sub"])


@router.put("/me/jira-account")
async def update_jira_account(body: JiraAccountBody, auth: dict = Depends(get_auth)):
    users_repo.set_jira_account_id(auth["sub"], body.jiraAccountId or None)
    return build_session(auth["sub"])


@router.post("/me/jira-account/detect")
async def detect_jira_account(body: JiraAccountDetectBody, auth: dict = Depends(get_auth)):
    from services.jira_service import resolve_jira, lookup_user_account_id

    user = users_repo.find_by_id(auth["sub"])
    if not user:
        raise HttpError.unauthorized()

    query = user.get("email") or user.get("username") or ""
    if not query:
        raise HttpError.bad_request("Your user profile has no email to search in Jira")

    creds = None
    if body.projectId:
        resolved = resolve_jira(body.projectId)
        if resolved:
            creds = resolved["creds"]

    if not creds:
        from db.projects import projects_repo
        from middleware.auth import is_admin_role

        if is_admin_role(auth["role"]):
            projects = projects_repo.list_all()
        else:
            assignments = project_roles_repo.list_for_user(auth["sub"])
            projects = projects_repo.list_by_ids([a["projectId"] for a in assignments])

        for project in projects:
            resolved = resolve_jira(project["id"])
            if resolved:
                creds = resolved["creds"]
                break

    if not creds:
        raise HttpError.bad_request(
            "No Jira connection available. Ask an admin to configure Jira on a project first."
        )

    match = await lookup_user_account_id(creds, query)
    if not match:
        raise HttpError.not_found(
            f"No Jira user found for {query}. Paste your accountId manually from Jira profile."
        )

    users_repo.set_jira_account_id(auth["sub"], match["accountId"])
    session = build_session(auth["sub"])
    return {
        **session,
        "detected": match,
    }
