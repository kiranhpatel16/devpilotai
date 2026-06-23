from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from lib.errors import HttpError
from lib.crypto import encrypt_secret
from middleware.auth import require_admin, get_auth
from db.projects import projects_repo
from db.project_roles import project_roles_repo
from db.environments import environments_repo
from db.activities import activities_repo
from services.jira_service import resolve_jira, test_connection
from services.pr_service import test_git_connection
from services.repo_context import list_frontend_themes

router = APIRouter(prefix="/api/admin/projects", tags=["admin-projects"])


def _persist_jira_token(project_id: str, api_token: str | None | object) -> None:
    if api_token is ...:  # sentinel for "not provided"
        return
    if not api_token:
        projects_repo.set_jira_token_enc(project_id, None)
    else:
        projects_repo.set_jira_token_enc(project_id, encrypt_secret(api_token))


def _persist_git_token(project_id: str, api_token: str | None | object) -> None:
    if api_token is ...:
        return
    if not api_token:
        projects_repo.set_git_token_enc(project_id, None)
    else:
        projects_repo.set_git_token_enc(project_id, encrypt_secret(api_token))


class DefaultsInput(BaseModel):
    projectRoot: Optional[str] = None
    frontendUrl: Optional[str] = None
    backendUrl: Optional[str] = None
    dockerComposePath: Optional[str] = None
    dockerPatchId: Optional[str] = None


class GitInput(BaseModel):
    remote: Optional[str] = None
    productionBranch: Optional[str] = None
    stagingBranch: Optional[str] = None
    prTargetBranch: Optional[str] = None
    commitMessageTemplate: Optional[str] = None
    prProvider: Optional[str] = None
    repoOwner: Optional[str] = None
    repoName: Optional[str] = None
    apiUsername: Optional[str] = None
    apiToken: Optional[str] = None


class JiraInput(BaseModel):
    baseUrl: Optional[str] = None
    projectKey: Optional[str] = None
    email: Optional[str] = None
    statusFilters: Optional[list[str]] = None
    assigneeFilter: Optional[str] = None
    apiToken: Optional[str] = None


class CreateProjectBody(BaseModel):
    name: str
    slug: str
    description: Optional[str] = None
    enabled: Optional[bool] = True
    frontendTheme: Optional[str] = None
    defaults: Optional[DefaultsInput] = None
    git: Optional[GitInput] = None
    jira: Optional[JiraInput] = None


class UpdateProjectBody(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    description: Optional[str] = None
    enabled: Optional[bool] = None
    frontendTheme: Optional[str] = None
    defaults: Optional[DefaultsInput] = None
    git: Optional[GitInput] = None
    jira: Optional[JiraInput] = None


@router.get("")
async def list_projects(auth: dict = Depends(require_admin)):
    projects = projects_repo.list_all()
    return {"projects": [{
        **p,
        "userCount": project_roles_repo.count_users_for_project(p["id"]),
        "hasJiraToken": projects_repo.has_jira_token(p["id"]),
        "hasGitToken": projects_repo.has_git_token(p["id"]),
    } for p in projects]}


@router.post("", status_code=201)
async def create_project(body: CreateProjectBody, auth: dict = Depends(require_admin)):
    import re
    if not re.match(r"^[a-z0-9-]+$", body.slug):
        raise HttpError.bad_request("Slug must be lowercase letters, numbers, and dashes")
    if projects_repo.find_by_slug(body.slug):
        raise HttpError.conflict("Project slug already exists")

    input_data = {
        "name": body.name,
        "slug": body.slug,
        "description": body.description,
        "enabled": body.enabled,
        "frontendTheme": body.frontendTheme,
        "defaults": body.defaults.model_dump() if body.defaults else {},
        "git": {k: v for k, v in (body.git.model_dump() if body.git else {}).items() if k != "apiToken"},
        "jira": body.jira.model_dump() if body.jira else {},
    }
    project = projects_repo.create(input_data)
    api_token = body.jira.apiToken if body.jira else None
    if api_token:
        _persist_jira_token(project["id"], api_token)
    git_token = body.git.apiToken if body.git else None
    if git_token:
        _persist_git_token(project["id"], git_token)

    activities_repo.create({
        "userId": auth["sub"], "username": auth["username"],
        "action": "project.created", "resourceType": "project",
        "resourceId": project["id"], "projectId": project["id"],
        "projectName": project["name"],
        "summary": f"{auth['username']} created project {project['name']}",
    })
    return {"project": project}


@router.put("/{project_id}")
async def update_project(project_id: str, body: UpdateProjectBody, auth: dict = Depends(require_admin)):
    existing = projects_repo.find_by_id(project_id)
    if not existing:
        raise HttpError.not_found("Project not found")

    if body.slug and body.slug != existing["slug"]:
        conflict = projects_repo.find_by_slug(body.slug)
        if conflict and conflict["id"] != existing["id"]:
            raise HttpError.conflict("Project slug already exists")

    input_data = {}
    if body.name is not None:
        input_data["name"] = body.name
    if body.slug is not None:
        input_data["slug"] = body.slug
    if body.description is not None:
        input_data["description"] = body.description
    if body.enabled is not None:
        input_data["enabled"] = body.enabled
    if body.frontendTheme is not None:
        input_data["frontendTheme"] = body.frontendTheme
    if body.defaults is not None:
        input_data["defaults"] = {k: v for k, v in body.defaults.model_dump().items() if v is not None}
    if body.git is not None:
        git_fields = body.git.model_dump(exclude_unset=True)
        git_token = git_fields.pop("apiToken", ...)
        git_data = {k: v for k, v in git_fields.items() if v is not None}
        if git_data:
            input_data["git"] = git_data
        if git_token is not ... and git_token:
            _persist_git_token(project_id, git_token)
    if body.jira is not None:
        jira_fields = body.jira.model_dump(exclude_unset=True)
        jira_token = jira_fields.pop("apiToken", ...)
        jira_data = {k: v for k, v in jira_fields.items() if v is not None}
        if jira_data:
            input_data["jira"] = jira_data
        if jira_token is not ... and jira_token:
            _persist_jira_token(project_id, jira_token)

    project = projects_repo.update(project_id, input_data)
    activities_repo.create({
        "userId": auth["sub"], "username": auth["username"],
        "action": "project.updated", "resourceType": "project",
        "resourceId": project["id"], "projectId": project["id"],
        "projectName": project["name"],
        "summary": f"{auth['username']} updated project {project['name']}",
    })
    return {"project": project}


@router.delete("/{project_id}")
async def delete_project(project_id: str, auth: dict = Depends(require_admin)):
    existing = projects_repo.find_by_id(project_id)
    if not existing:
        raise HttpError.not_found("Project not found")
    projects_repo.delete(project_id)
    activities_repo.create({
        "userId": auth["sub"], "username": auth["username"],
        "action": "project.deleted", "resourceType": "project",
        "resourceId": project_id, "projectId": project_id,
        "projectName": existing["name"],
        "summary": f"{auth['username']} deleted project {existing['name']}",
    })
    return {"ok": True}


@router.post("/{project_id}/jira/test")
async def test_jira(project_id: str, auth: dict = Depends(require_admin)):
    if not projects_repo.find_by_id(project_id):
        raise HttpError.not_found("Project not found")
    resolved = resolve_jira(project_id)
    if not resolved:
        raise HttpError.bad_request("Jira is not fully configured (need base URL, email, and API token)")
    me = await test_connection(resolved["creds"])
    return {"ok": True, "accountId": me.get("accountId"), "displayName": me.get("displayName")}


class GitTestBody(BaseModel):
    prProvider: Optional[str] = None
    repoOwner: Optional[str] = None
    repoName: Optional[str] = None
    apiUsername: Optional[str] = None
    apiToken: Optional[str] = None


@router.post("/{project_id}/git/test")
async def test_git(project_id: str, body: GitTestBody = GitTestBody(), auth: dict = Depends(require_admin)):
    project = projects_repo.find_by_id(project_id)
    if not project:
        raise HttpError.not_found("Project not found")
    env = environments_repo.find(auth["sub"], project_id)
    cwd = (env["projectRoot"] if env else None) or project["defaults"].get("projectRoot") or "."
    overrides = body.model_dump(exclude_unset=True)
    result = await test_git_connection(project_id, cwd, overrides or None)
    return {"ok": True, **result}


@router.get("/{project_id}/git/detect")
async def detect_git_repo(project_id: str, auth: dict = Depends(require_admin)):
    project = projects_repo.find_by_id(project_id)
    if not project:
        raise HttpError.not_found("Project not found")
    env = environments_repo.find(auth["sub"], project_id)
    cwd = (env["projectRoot"] if env else None) or project["defaults"].get("projectRoot") or ""
    if not cwd:
        raise HttpError.bad_request("Set a default project root first")
    from services.pr_service import _detect_remote_repo
    detected = _detect_remote_repo(cwd, project["git"].get("remote") or "origin")
    if not detected:
        raise HttpError.bad_request(f"Could not read git remote from {cwd}")
    return {"detected": detected, "scannedPath": cwd}


@router.get("/{project_id}/themes")
async def get_themes(project_id: str, auth: dict = Depends(get_auth)):
    project = projects_repo.find_by_id(project_id)
    if not project:
        raise HttpError.not_found("Project not found")
    env = environments_repo.find(auth["sub"], project_id)
    cwd = (env["projectRoot"] if env else None) or project["defaults"].get("projectRoot", "")
    themes = list_frontend_themes(cwd) if cwd else []
    return {"themes": themes, "scannedPath": cwd or None}


@router.get("/{project_id}/environments")
async def get_environments(project_id: str, auth: dict = Depends(require_admin)):
    if not projects_repo.find_by_id(project_id):
        raise HttpError.not_found("Project not found")
    return {"environments": environments_repo.list_for_project(project_id)}
