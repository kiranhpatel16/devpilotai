from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
import re
from lib.errors import HttpError
from lib.crypto import encrypt_secret
from middleware.auth import require_admin
from db.ai_settings import ai_settings_repo
from db.custom_ai_providers import custom_ai_providers_repo
from services.ai_providers.catalog import PROVIDER_CATALOG, PROVIDER_IDS
from services.ai_providers.registry import get_adapter, resolve_creds, list_provider_info, _catalog_entry

router = APIRouter(prefix="/api/admin/ai-providers", tags=["admin-ai-providers"])


class UpdateProviderBody(BaseModel):
    enabled: Optional[bool] = None
    apiKey: Optional[str] = None
    baseUrl: Optional[str] = None
    defaultModel: Optional[str] = None


class CreateProviderBody(BaseModel):
    id: str
    label: str
    defaultBaseUrl: Optional[str] = "https://api.openai.com/v1"
    models: list[str]
    defaultModel: Optional[str] = None
    apiKey: Optional[str] = None
    enabled: Optional[bool] = False


def _is_known_provider(provider_id: str) -> bool:
    return provider_id in PROVIDER_IDS or custom_ai_providers_repo.find_by_id(provider_id) is not None


@router.get("")
async def list_providers(auth: dict = Depends(require_admin)):
    return {"providers": list_provider_info()}


@router.post("", status_code=201)
async def create_provider(body: CreateProviderBody, auth: dict = Depends(require_admin)):
    pid = body.id.strip().lower()
    if not re.match(r"^[a-z0-9_-]+$", pid):
        raise HttpError.bad_request("Provider id must be lowercase letters, numbers, dashes, and underscores")
    if pid in PROVIDER_IDS:
        raise HttpError.conflict("That id is reserved for a built-in provider")
    if custom_ai_providers_repo.find_by_id(pid):
        raise HttpError.conflict("Provider id already exists")

    models = [m.strip() for m in body.models if m.strip()]
    if not models:
        raise HttpError.bad_request("At least one model is required")

    default_model = body.defaultModel or models[0]
    if default_model not in models:
        raise HttpError.bad_request("Default model must be one of the listed models")

    custom_ai_providers_repo.create({
        "id": pid,
        "label": body.label.strip(),
        "defaultBaseUrl": body.defaultBaseUrl or "https://api.openai.com/v1",
        "models": models,
    })

    settings_fields: dict = {
        "enabled": body.enabled if body.enabled is not None else False,
        "defaultModel": default_model,
    }
    if body.apiKey:
        settings_fields["apiKeyEnc"] = encrypt_secret(body.apiKey)
    ai_settings_repo.upsert(pid, settings_fields, auth["sub"])

    return {"providers": list_provider_info()}


@router.put("/{provider_id}")
async def update_provider(provider_id: str, body: UpdateProviderBody, auth: dict = Depends(require_admin)):
    if not _is_known_provider(provider_id):
        raise HttpError.not_found("Unknown provider")

    fields = {}
    if body.enabled is not None:
        fields["enabled"] = body.enabled
    if body.baseUrl is not None:
        fields["baseUrl"] = body.baseUrl
    if body.defaultModel is not None:
        entry = _catalog_entry(provider_id)
        if entry and body.defaultModel not in entry["models"]:
            raise HttpError.bad_request("Default model must be one of the provider's models")
        fields["defaultModel"] = body.defaultModel
    if body.apiKey is not None:
        fields["apiKeyEnc"] = encrypt_secret(body.apiKey) if body.apiKey else None

    ai_settings_repo.upsert(provider_id, fields, auth["sub"])
    return {"providers": list_provider_info()}


@router.delete("/{provider_id}")
async def delete_provider(provider_id: str, auth: dict = Depends(require_admin)):
    if provider_id in PROVIDER_IDS:
        raise HttpError.bad_request("Built-in providers cannot be deleted")
    custom = custom_ai_providers_repo.find_by_id(provider_id)
    if not custom:
        raise HttpError.not_found("Unknown provider")
    custom_ai_providers_repo.delete(provider_id)
    ai_settings_repo.delete(provider_id)
    return {"ok": True}


@router.post("/{provider_id}/test")
async def test_provider(provider_id: str, auth: dict = Depends(require_admin)):
    if not _is_known_provider(provider_id):
        raise HttpError.not_found("Unknown provider")
    resolved = resolve_creds(provider_id)
    adapter = get_adapter(provider_id)
    await adapter["verify"](resolved["creds"])
    entry = _catalog_entry(provider_id)
    return {"ok": True, "provider": provider_id, "label": entry["label"] if entry else provider_id}
