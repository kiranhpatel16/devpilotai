import uuid
import json
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from middleware.auth import get_auth, is_admin_role
from db.project_roles import project_roles_repo
from database import get_db, now_iso
from lib.errors import HttpError

router = APIRouter(prefix="/api/deployments", tags=["deployments"])


def _assert_access(auth: dict, project_id: str):
    if is_admin_role(auth["role"]):
        return
    if not project_roles_repo.get_role(auth["sub"], project_id):
        raise HttpError.forbidden("You are not assigned to this project")


@router.get("")
async def list_deployments(auth: dict = Depends(get_auth)):
    if is_admin_role(auth["role"]):
        rows = get_db().execute(
            "SELECT * FROM deployment_records ORDER BY created_at DESC LIMIT 50"
        ).fetchall()
    else:
        project_ids = [r["projectId"] for r in project_roles_repo.list_for_user(auth["sub"])]
        if not project_ids:
            return {"deployments": []}
        placeholders = ",".join("?" * len(project_ids))
        rows = get_db().execute(
            f"SELECT * FROM deployment_records WHERE project_id IN ({placeholders}) ORDER BY created_at DESC LIMIT 50",
            project_ids,
        ).fetchall()
    return {
        "deployments": [
            {
                "id": r["id"],
                "projectId": r["project_id"],
                "runId": r["run_id"],
                "environment": r["environment"],
                "status": r["status"],
                "createdAt": r["created_at"],
            }
            for r in rows
        ]
    }


class RecordDeploymentBody(BaseModel):
    projectId: str
    runId: Optional[str] = None
    environment: str = "staging"
    status: str = "success"
    logs: Optional[list[str]] = None


@router.post("", status_code=201)
async def record_deployment(body: RecordDeploymentBody, auth: dict = Depends(get_auth)):
    _assert_access(auth, body.projectId)
    dep_id = str(uuid.uuid4())
    db = get_db()
    db.execute(
        """INSERT INTO deployment_records
           (id, project_id, run_id, environment, status, logs_json, created_by, created_at)
           VALUES (?,?,?,?,?,?,?,?)""",
        (
            dep_id, body.projectId, body.runId, body.environment, body.status,
            json.dumps(body.logs or []), auth["sub"], now_iso(),
        ),
    )
    db.commit()
    return {"id": dep_id, "status": body.status}
