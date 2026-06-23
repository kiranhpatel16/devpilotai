from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from typing import Optional
from lib.errors import HttpError
from lib.crypto import encrypt_secret
from middleware.auth import get_auth, is_admin_role
from db.projects import projects_repo
from db.project_roles import project_roles_repo
from db.environments import environments_repo
from db.activities import activities_repo
from services.environment import (
    resolve_environment,
    check_environment_path,
    resolve_database_config,
    detect_database_config,
)

router = APIRouter(prefix="/api/projects", tags=["projects"])


def _assert_access(auth: dict, project_id: str):
    if is_admin_role(auth["role"]):
        return
    role = project_roles_repo.get_role(auth["sub"], project_id)
    if not role:
        raise HttpError.forbidden("You are not assigned to this project")


class EnvironmentBody(BaseModel):
    projectRoot: str
    frontendUrl: Optional[str] = None
    backendUrl: Optional[str] = None
    databaseHost: Optional[str] = None
    databasePort: Optional[int] = None
    databaseName: Optional[str] = None
    databaseUser: Optional[str] = None
    databasePassword: Optional[str] = None
    dockerComposePath: Optional[str] = None
    phpBin: Optional[str] = None


class TestEnvBody(BaseModel):
    projectRoot: Optional[str] = None
    phpBin: Optional[str] = None
    databaseHost: Optional[str] = None
    databasePort: Optional[int] = None
    databaseName: Optional[str] = None
    databaseUser: Optional[str] = None
    databasePassword: Optional[str] = None
    dockerComposePath: Optional[str] = None


def _db_config_for_check(
    project_root: str,
    body: TestEnvBody | EnvironmentBody,
    saved: dict | None,
    user_id: str,
    project_id: str,
) -> dict | None:
    password = getattr(body, "databasePassword", None)
    if not password and saved:
        password = environments_repo.get_database_password(user_id, project_id)

    docker_compose_path = (
        getattr(body, "dockerComposePath", None) or (saved or {}).get("dockerComposePath")
    )

    return resolve_database_config(
        project_root,
        database_host=getattr(body, "databaseHost", None) or (saved or {}).get("databaseHost"),
        database_port=getattr(body, "databasePort", None) or (saved or {}).get("databasePort"),
        database_name=getattr(body, "databaseName", None) or (saved or {}).get("databaseName"),
        database_user=getattr(body, "databaseUser", None) or (saved or {}).get("databaseUser"),
        database_password=password,
        docker_compose_path=docker_compose_path,
    )


@router.get("")
async def list_projects(auth: dict = Depends(get_auth)):
    if is_admin_role(auth["role"]):
        projects = projects_repo.list_all()
    else:
        assignments = project_roles_repo.list_for_user(auth["sub"])
        projects = projects_repo.list_by_ids([a["projectId"] for a in assignments])

    result = []
    for p in projects:
        env = environments_repo.find(auth["sub"], p["id"])
        result.append({
            **p,
            "myRole": project_roles_repo.get_role(auth["sub"], p["id"]),
            "hasEnvironment": bool(env),
            "environmentVerified": bool(env and env.get("pathVerifiedAt")),
        })
    return {"projects": result}


@router.get("/{project_id}")
async def get_project(project_id: str, auth: dict = Depends(get_auth)):
    _assert_access(auth, project_id)
    project = projects_repo.find_by_id(project_id)
    if not project:
        raise HttpError.not_found("Project not found")
    return {
        "project": project,
        "myRole": project_roles_repo.get_role(auth["sub"], project_id),
        "myEnvironment": environments_repo.find(auth["sub"], project_id),
    }


@router.get("/{project_id}/my-environment")
async def get_my_environment(project_id: str, auth: dict = Depends(get_auth)):
    _assert_access(auth, project_id)
    project = projects_repo.find_by_id(project_id)
    if not project:
        raise HttpError.not_found("Project not found")
    env = environments_repo.find(auth["sub"], project_id)
    return {
        "environment": env,
        "defaults": project["defaults"],
        "hasDatabasePassword": environments_repo.has_database_password(auth["sub"], project_id),
        "detectedDatabase": detect_database_config(
            (env or {}).get("projectRoot") or project["defaults"].get("projectRoot") or "",
            (env or {}).get("dockerComposePath"),
        ),
    }


@router.get("/{project_id}/my-environment/detect-database")
async def detect_my_database(
    project_id: str,
    project_root: Optional[str] = Query(None, alias="projectRoot"),
    auth: dict = Depends(get_auth),
):
    _assert_access(auth, project_id)
    project = projects_repo.find_by_id(project_id)
    if not project:
        raise HttpError.not_found("Project not found")

    saved = environments_repo.find(auth["sub"], project_id)
    root = project_root or (saved or {}).get("projectRoot") or project["defaults"].get("projectRoot") or ""
    if not root:
        raise HttpError.bad_request("Set a project path first")

    detected = detect_database_config(root, (saved or {}).get("dockerComposePath"))
    if not detected:
        raise HttpError.bad_request(f"No Magento env.php database config found under {root}")

    return {"detected": detected, "projectRoot": root}


@router.put("/{project_id}/my-environment")
async def save_my_environment(project_id: str, body: EnvironmentBody, auth: dict = Depends(get_auth)):
    _assert_access(auth, project_id)
    project = projects_repo.find_by_id(project_id)
    if not project:
        raise HttpError.not_found("Project not found")

    env = environments_repo.upsert(auth["sub"], project_id, {
        "projectRoot": body.projectRoot,
        "frontendUrl": body.frontendUrl,
        "backendUrl": body.backendUrl,
        "databaseHost": body.databaseHost,
        "databasePort": body.databasePort,
        "databaseName": body.databaseName,
        "databaseUser": body.databaseUser,
        "databasePasswordEnc": encrypt_secret(body.databasePassword) if body.databasePassword else None,
        "dockerComposePath": body.dockerComposePath,
        "phpBin": body.phpBin,
    })

    activities_repo.create({
        "userId": auth["sub"], "username": auth["username"],
        "action": "user.environment_updated", "resourceType": "environment",
        "resourceId": env["id"], "projectId": project_id, "projectName": project["name"],
        "summary": f"{auth['username']} updated local environment for {project['name']}",
        "metadata": {"projectRoot": body.projectRoot},
    })
    return {"environment": env}


@router.post("/{project_id}/my-environment/test")
async def test_my_environment(project_id: str, body: TestEnvBody, auth: dict = Depends(get_auth)):
    _assert_access(auth, project_id)
    project = projects_repo.find_by_id(project_id)
    if not project:
        raise HttpError.not_found("Project not found")

    saved = environments_repo.find(auth["sub"], project_id)
    project_root = body.projectRoot or (saved["projectRoot"] if saved else "") or ""
    if not project_root:
        raise HttpError.bad_request("No project path to test")

    php_bin = body.phpBin or (saved["phpBin"] if saved else None)
    db_config = _db_config_for_check(project_root, body, saved, auth["sub"], project_id)
    health = check_environment_path(project_root, php_bin, db_config)
    if saved:
        environments_repo.save_health(auth["sub"], project_id, health)
    return {"health": health}


@router.get("/{project_id}/health")
async def get_health(project_id: str, auth: dict = Depends(get_auth)):
    _assert_access(auth, project_id)
    resolved = resolve_environment(auth["sub"], project_id)
    db_config = resolve_database_config(
        resolved["cwd"],
        database_host=resolved["env"].get("databaseHost"),
        database_port=resolved["env"].get("databasePort"),
        database_name=resolved["env"].get("databaseName"),
        database_user=resolved["env"].get("databaseUser"),
        database_password=environments_repo.get_database_password(auth["sub"], project_id),
        docker_compose_path=resolved["env"].get("dockerComposePath"),
    )
    health = check_environment_path(resolved["cwd"], resolved["env"].get("phpBin"), db_config)
    environments_repo.save_health(auth["sub"], project_id, health)
    return {"health": health, "cwd": resolved["cwd"]}
