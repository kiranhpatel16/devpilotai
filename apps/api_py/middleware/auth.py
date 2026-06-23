from fastapi import Request, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional
from lib.jwt_utils import verify_token, AUTH_COOKIE
from lib.errors import HttpError
from db.users import users_repo

_bearer = HTTPBearer(auto_error=False)

ADMIN_ROLES = {"super_admin", "admin"}
WRITE_ROLES = {"super_admin", "admin", "developer"}


def _extract_token(request: Request, credentials: Optional[HTTPAuthorizationCredentials]) -> str | None:
    cookie_token = request.cookies.get(AUTH_COOKIE)
    if cookie_token:
        return cookie_token
    if credentials:
        return credentials.credentials
    return None


def get_auth(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> dict:
    token = _extract_token(request, credentials)
    if not token:
        raise HttpError.unauthorized()
    payload = verify_token(token)
    if not payload:
        raise HttpError.unauthorized("Invalid or expired session")
    user = users_repo.find_by_id(payload["sub"])
    if not user or user["status"] != "active":
        raise HttpError.unauthorized("Account is not active")
    return payload


def get_auth_optional(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> dict | None:
    token = _extract_token(request, credentials)
    if not token:
        return None
    payload = verify_token(token)
    if not payload:
        return None
    return payload


def require_admin(auth: dict = Depends(get_auth)) -> dict:
    if auth.get("role") not in ADMIN_ROLES:
        raise HttpError.forbidden("Admin access required")
    return auth


def is_admin_role(role: str) -> bool:
    return role in ADMIN_ROLES


def can_write_on_project(role: str) -> bool:
    return role in WRITE_ROLES
