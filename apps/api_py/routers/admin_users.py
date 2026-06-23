from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, EmailStr
from typing import Optional
from lib.errors import HttpError
from lib.password import hash_password, validate_password_strength
from middleware.auth import require_admin
from db.users import users_repo, to_public_user
from db.project_roles import project_roles_repo
from db.activities import activities_repo

router = APIRouter(prefix="/api/admin/users", tags=["admin-users"])

GLOBAL_ROLES = ("super_admin", "admin", "developer", "viewer")
PROJECT_ROLES = ("admin", "developer", "viewer")


class CreateUserBody(BaseModel):
    username: str
    displayName: str
    email: Optional[str] = None
    password: str
    globalRole: str


class UpdateUserBody(BaseModel):
    displayName: Optional[str] = None
    email: Optional[str] = None
    globalRole: Optional[str] = None
    status: Optional[str] = None


class RoleAssignment(BaseModel):
    projectId: str
    role: str


class RolesBody(BaseModel):
    assignments: list[RoleAssignment]


class ResetPasswordBody(BaseModel):
    newPassword: str
    mustChange: Optional[bool] = True


@router.get("")
async def list_users(auth: dict = Depends(require_admin)):
    users = users_repo.list_all()
    return {"users": [{**u, "projectRoles": project_roles_repo.list_for_user(u["id"])} for u in users]}


@router.post("", status_code=201)
async def create_user(body: CreateUserBody, request: Request, auth: dict = Depends(require_admin)):
    if body.globalRole not in GLOBAL_ROLES:
        raise HttpError.bad_request(f"Invalid global role: {body.globalRole}")
    err = validate_password_strength(body.password)
    if err:
        raise HttpError.bad_request(err)
    if users_repo.find_by_username(body.username):
        raise HttpError.conflict("Username already exists")

    pw_hash = hash_password(body.password)
    user = users_repo.create(
        username=body.username,
        display_name=body.displayName,
        password_hash=pw_hash,
        global_role=body.globalRole,
        email=body.email,
        must_change_password=True,
    )
    activities_repo.create({
        "userId": auth["sub"], "username": auth["username"],
        "action": "user.created", "resourceType": "user", "resourceId": user["id"],
        "summary": f"{auth['username']} created user {user['username']}",
    })
    return {"user": to_public_user(user)}


@router.put("/{user_id}")
async def update_user(user_id: str, body: UpdateUserBody, auth: dict = Depends(require_admin)):
    target = users_repo.find_by_id(user_id)
    if not target:
        raise HttpError.not_found("User not found")

    # Protect last super_admin
    if target["globalRole"] == "super_admin":
        demoting = (body.globalRole and body.globalRole != "super_admin") or body.status == "disabled"
        if demoting and users_repo.count_by_role("super_admin") <= 1:
            raise HttpError.bad_request("Cannot demote or disable the last super admin")

    fields = {}
    if body.displayName is not None:
        fields["displayName"] = body.displayName
    if body.email is not None:
        fields["email"] = body.email
    if body.globalRole is not None:
        fields["globalRole"] = body.globalRole
    if body.status is not None:
        fields["status"] = body.status

    updated = users_repo.update(user_id, fields)
    activities_repo.create({
        "userId": auth["sub"], "username": auth["username"],
        "action": "user.updated", "resourceType": "user", "resourceId": target["id"],
        "summary": f"{auth['username']} updated user {target['username']}",
    })
    return {"user": to_public_user(updated)}


@router.delete("/{user_id}")
async def delete_user(user_id: str, auth: dict = Depends(require_admin)):
    if user_id == auth["sub"]:
        raise HttpError.bad_request("You cannot delete your own account")
    target = users_repo.find_by_id(user_id)
    if not target:
        raise HttpError.not_found("User not found")
    if target["globalRole"] == "super_admin" and users_repo.count_by_role("super_admin") <= 1:
        raise HttpError.bad_request("Cannot delete the last super admin")
    users_repo.delete(user_id)
    activities_repo.create({
        "userId": auth["sub"], "username": auth["username"],
        "action": "user.deleted", "resourceType": "user", "resourceId": user_id,
        "summary": f"{auth['username']} deleted user {target['username']}",
    })
    return {"ok": True}


@router.get("/{user_id}/project-roles")
async def get_project_roles(user_id: str, auth: dict = Depends(require_admin)):
    if not users_repo.find_by_id(user_id):
        raise HttpError.not_found("User not found")
    return {"assignments": project_roles_repo.list_for_user(user_id)}


@router.put("/{user_id}/project-roles")
async def set_project_roles(user_id: str, body: RolesBody, auth: dict = Depends(require_admin)):
    target = users_repo.find_by_id(user_id)
    if not target:
        raise HttpError.not_found("User not found")
    project_roles_repo.set_for_user(
        user_id, [{"projectId": a.projectId, "role": a.role} for a in body.assignments], auth["sub"]
    )
    activities_repo.create({
        "userId": auth["sub"], "username": auth["username"],
        "action": "user.role_changed", "resourceType": "user", "resourceId": target["id"],
        "summary": f"{auth['username']} updated project roles for {target['username']}",
        "metadata": {"count": len(body.assignments)},
    })
    return {"assignments": project_roles_repo.list_for_user(user_id)}


@router.post("/{user_id}/reset-password")
async def reset_password(user_id: str, body: ResetPasswordBody, auth: dict = Depends(require_admin)):
    err = validate_password_strength(body.newPassword)
    if err:
        raise HttpError.bad_request(err)
    target = users_repo.find_by_id(user_id)
    if not target:
        raise HttpError.not_found("User not found")
    pw_hash = hash_password(body.newPassword)
    users_repo.update(user_id, {"passwordHash": pw_hash, "mustChangePassword": body.mustChange if body.mustChange is not None else True})
    activities_repo.create({
        "userId": auth["sub"], "username": auth["username"],
        "action": "auth.password_reset", "resourceType": "user", "resourceId": target["id"],
        "summary": f"{auth['username']} reset password for {target['username']}",
    })
    return {"ok": True}
