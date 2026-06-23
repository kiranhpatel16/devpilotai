from lib.errors import HttpError
from lib.crypto import decrypt_secret
from db.ai_settings import ai_settings_repo
from db.custom_ai_providers import custom_ai_providers_repo
from services.ai_providers.catalog import PROVIDER_CATALOG, PROVIDER_IDS
from services.ai_providers.openai_compatible import make_openai_compatible_adapter
from services.ai_providers.gemini import gemini_adapter

ADAPTERS = {
    "openai": make_openai_compatible_adapter("openai", PROVIDER_CATALOG["openai"]["defaultBaseUrl"]),
    "grok": make_openai_compatible_adapter("grok", PROVIDER_CATALOG["grok"]["defaultBaseUrl"]),
    "cloud_ai": gemini_adapter,
    # cursor: not wired in this build
}


def _custom_adapter(provider_id: str):
    custom = custom_ai_providers_repo.find_by_id(provider_id)
    if not custom:
        return None
    return make_openai_compatible_adapter(provider_id, custom["defaultBaseUrl"])


def get_adapter(provider_id: str) -> dict:
    adapter = ADAPTERS.get(provider_id)
    if not adapter:
        adapter = _custom_adapter(provider_id)
    if not adapter:
        raise HttpError.bad_request(
            f'Provider "{provider_id}" is not available in this build. Use openai, grok, or cloud_ai.',
            "provider_unavailable",
        )
    return adapter


def _catalog_entry(provider_id: str) -> dict | None:
    if provider_id in PROVIDER_CATALOG:
        return PROVIDER_CATALOG[provider_id]
    custom = custom_ai_providers_repo.find_by_id(provider_id)
    if custom:
        return {
            "id": custom["id"],
            "label": custom["label"],
            "defaultBaseUrl": custom["defaultBaseUrl"],
            "defaultModel": custom["models"][0] if custom["models"] else "gpt-4o-mini",
            "models": custom["models"],
            "supportsAgent": True,
            "custom": True,
        }
    return None


def resolve_creds(provider_id: str, model_override: str | None = None) -> dict:
    entry = _catalog_entry(provider_id)
    if not entry:
        raise HttpError.not_found(f'Unknown provider: {provider_id}')
    setting = ai_settings_repo.get(provider_id)
    if not setting or not setting["enabled"]:
        raise HttpError.bad_request(
            f'Provider "{provider_id}" is not enabled. Configure it in Admin → AI Providers.',
            "provider_disabled",
        )
    api_key = decrypt_secret(setting["apiKeyEnc"]) if setting["apiKeyEnc"] else None
    if not api_key:
        raise HttpError.bad_request(
            f'Provider "{provider_id}" has no valid API key.', "provider_no_key"
        )
    model = model_override or setting["defaultModel"] or entry["defaultModel"]
    return {
        "creds": {
            "apiKey": api_key,
            "baseUrl": setting["baseUrl"],
            "defaultModel": setting["defaultModel"] or entry["defaultModel"],
            "extra": setting["extra"],
        },
        "model": model,
    }


def list_provider_info() -> list[dict]:
    result = []
    all_ids = list(PROVIDER_IDS) + [c["id"] for c in custom_ai_providers_repo.list_all()]
    seen = set()
    for pid in all_ids:
        if pid in seen:
            continue
        seen.add(pid)
        entry = _catalog_entry(pid)
        if not entry:
            continue
        setting = ai_settings_repo.get(pid)
        available = pid in ADAPTERS or custom_ai_providers_repo.find_by_id(pid) is not None
        result.append({
            "id": pid,
            "label": entry["label"],
            "enabled": bool(setting and setting["enabled"]) and available,
            "configured": bool(setting and setting["apiKeyEnc"]) and available,
            "defaultModel": (setting["defaultModel"] if setting else None) or entry["defaultModel"],
            "models": entry["models"],
            "supportsAgent": entry["supportsAgent"] and available,
            "custom": entry.get("custom", False),
        })
    return result


def enabled_provider_info() -> list[dict]:
    return [p for p in list_provider_info() if p["enabled"] and p["configured"]]
