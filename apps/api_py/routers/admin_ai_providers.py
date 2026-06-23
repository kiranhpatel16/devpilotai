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
from services.ai_providers.registry import (
    get_adapter,
    resolve_creds,
    resolve_creds_for_test,
    list_provider_info,
    _catalog_entry,
    _effective_models,
    validate_endpoint_models,
)

router = APIRouter(prefix="/api/admin/ai-providers", tags=["admin-ai-providers"])


class UpdateProviderBody(BaseModel):
    enabled: Optional[bool] = None
    apiKey: Optional[str] = None
    baseUrl: Optional[str] = None
    defaultModel: Optional[str] = None
    models: Optional[list[str]] = None


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

    raw = body.model_dump(exclude_unset=True)
    setting = ai_settings_repo.get(provider_id)
    entry = _catalog_entry(provider_id)
    if not entry:
        raise HttpError.not_found("Unknown provider")

    fields: dict = {}
    models_updated: list[str] | None = None

    if "models" in raw:
        models_updated = [m.strip() for m in raw["models"] if m and m.strip()]
        if not models_updated:
            raise HttpError.bad_request("At least one model is required")
        if provider_id in PROVIDER_IDS:
            extra = dict(setting["extra"]) if setting else {}
            extra["models"] = models_updated
            fields["extra"] = extra
        else:
            custom_ai_providers_repo.update(provider_id, {"models": models_updated})

        if "defaultModel" not in raw:
            current_default = (
                (setting["defaultModel"] if setting else None) or entry["defaultModel"]
            )
            if current_default not in models_updated:
                fields["defaultModel"] = models_updated[0]

    if "enabled" in raw:
        fields["enabled"] = raw["enabled"]
    if "baseUrl" in raw:
        fields["baseUrl"] = raw["baseUrl"]
    if "defaultModel" in raw:
        effective = models_updated or _effective_models(provider_id, entry, setting)
        if raw["defaultModel"] not in effective:
            raise HttpError.bad_request("Default model must be one of the provider's models")
        fields["defaultModel"] = raw["defaultModel"]
    if "apiKey" in raw:
        fields["apiKeyEnc"] = encrypt_secret(raw["apiKey"]) if raw["apiKey"] else None

    if fields:
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


class TestProviderBody(BaseModel):
    apiKey: Optional[str] = None
    baseUrl: Optional[str] = None
    defaultModel: Optional[str] = None


@router.post("/{provider_id}/test")
async def test_provider(
    provider_id: str,
    body: TestProviderBody = TestProviderBody(),
    auth: dict = Depends(require_admin),
):
    if not _is_known_provider(provider_id):
        raise HttpError.not_found("Unknown provider")
    overrides = body.model_dump(exclude_unset=True)
    resolved = resolve_creds_for_test(provider_id, overrides or None)
    setting = ai_settings_repo.get(provider_id)
    validate_endpoint_models(provider_id, resolved["creds"], setting)
    adapter = get_adapter(provider_id)
    await adapter["verify"](resolved["creds"])
    entry = _catalog_entry(provider_id)
    return {"ok": True, "provider": provider_id, "label": entry["label"] if entry else provider_id}
