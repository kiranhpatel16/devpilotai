from fastapi import APIRouter, Depends, Query
from middleware.auth import require_admin
from db.activities import activities_repo

router = APIRouter(prefix="/api/admin/activities", tags=["admin-activities"])


@router.get("")
async def list_activities(limit: int = Query(default=5, ge=1, le=200), auth: dict = Depends(require_admin)):
    return {"activities": activities_repo.recent(limit)}
