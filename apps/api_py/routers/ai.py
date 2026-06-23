from fastapi import APIRouter, Depends
from middleware.auth import get_auth
from services.ai_providers.registry import enabled_provider_info

router = APIRouter(prefix="/api/ai", tags=["ai"])


@router.get("/providers")
async def list_providers(auth: dict = Depends(get_auth)):
    return {"providers": enabled_provider_info()}
