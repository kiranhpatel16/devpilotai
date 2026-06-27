from lib.errors import HttpError
from lib.crypto import decrypt_secret
from db.ai_settings import ai_settings_repo
from db.custom_ai_providers import custom_ai_providers_repo
from services.ai_providers.catalog import PROVIDER_CATALOG, PROVIDER_IDS
from services.ai_providers.openai_compatible import make_openai_compatible_adapter
from services.ai_providers.gemini import gemini_adapter
from services.ai_providers.cursor import cursor_adapter

ADAPTERS = {
    "openai": make_openai_compatible_adapter("openai", PROVIDER_CATALOG["openai"]["defaultBaseUrl"]),
    "grok": make_openai_compatible_adapter("grok", PROVIDER_CATALOG["grok"]["defaultBaseUrl"]),
    "cloud_ai": gemini_adapter,
    "cursor": cursor_adapter,
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
            f'Provider "{provider_id}" is not available in this build. Use openai, grok, cloud_ai, or cursor.',
            "provider_unavailable",
        )
    return adapter


def _effective_models(provider_id: str, entry: dict, setting: dict | None) -> list[str]:
    if provider_id in PROVIDER_CATALOG and setting:
        override = setting.get("extra", {}).get("models")
        if isinstance(override, list) and override:
            return [str(m) for m in override if str(m).strip()]
    return entry["models"]


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
    return _build_resolved_creds(provider_id, entry, setting, model_override=model_override)


def resolve_creds_for_test(provider_id: str, overrides: dict | None = None) -> dict:
    """Resolve credentials for admin test — does not require enabled; accepts form overrides."""
    entry = _catalog_entry(provider_id)
    if not entry:
        raise HttpError.not_found(f'Unknown provider: {provider_id}')
    setting = ai_settings_repo.get(provider_id)
    return _build_resolved_creds(provider_id, entry, setting, overrides=overrides)


def _has_stored_key(setting: dict | None) -> bool:
    if not setting or not setting.get("apiKeyEnc"):
        return False
    return decrypt_secret(setting["apiKeyEnc"]) is not None


def _build_resolved_creds(
    provider_id: str,
    entry: dict,
    setting: dict | None,
    overrides: dict | None = None,
    model_override: str | None = None,
) -> dict:
    overrides = overrides or {}

    api_key = overrides.get("apiKey")
    if not api_key:
        enc = setting["apiKeyEnc"] if setting else None
        if enc:
            api_key = decrypt_secret(enc)
            if not api_key:
                raise HttpError.bad_request(
                    f'Provider "{provider_id}" has a stored API key that could not be read. '
                    "Re-enter the key and click Save (encryption key may have changed).",
                    "provider_key_decrypt_failed",
                )
        else:
            api_key = None
    if not api_key:
        raise HttpError.bad_request(
            f'Provider "{provider_id}" has no valid API key. Paste a key and Save, or enter one to test first.',
            "provider_no_key",
        )

    base_url = overrides["baseUrl"] if "baseUrl" in overrides else (setting["baseUrl"] if setting else None)
    default_model = (
        overrides.get("defaultModel")
        or (setting["defaultModel"] if setting else None)
        or entry["defaultModel"]
    )
    model = model_override or default_model
    return {
        "creds": {
            "apiKey": api_key,
            "baseUrl": base_url,
            "defaultModel": default_model,
            "extra": setting["extra"] if setting else {},
        },
        "model": model,
    }


def validate_endpoint_models(provider_id: str, creds: dict, setting: dict | None) -> None:
    """Warn when a model looks incompatible with a built-in provider's default API host."""
    if provider_id not in PROVIDER_CATALOG:
        return
    entry = _catalog_entry(provider_id)
    if not entry:
        return

    native_base = PROVIDER_CATALOG[provider_id].get("defaultBaseUrl")
    if not native_base:
        return

    active_base = (creds.get("baseUrl") or native_base).rstrip("/")
    if active_base != native_base.rstrip("/"):
        return

    # Admin customized the model list — let the live API verify the chosen model.
    if setting and isinstance(setting.get("extra", {}).get("models"), list) and setting["extra"]["models"]:
        return

    catalog_models = set(PROVIDER_CATALOG[provider_id]["models"])
    model = creds.get("defaultModel") or entry["defaultModel"]
    if model in catalog_models:
        return
    hints = {
        "grok": (
            "These models look like Groq/Llama IDs. Set Base URL to "
            "https://api.groq.com/openai/v1 and use your Groq API key, "
            "or switch to xAI models such as grok-2."
        ),
        "openai": "Set Base URL to your OpenAI-compatible API host if using third-party models.",
    }
    hint = hints.get(
        provider_id,
        "Set Base URL to the API host that supports these models.",
    )
    raise HttpError.bad_request(
        f'Model "{model}" is not available at the default {entry["label"]} endpoint ({native_base}). {hint}',
        "provider_model_mismatch",
    )


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
        is_custom = custom_ai_providers_repo.find_by_id(pid) is not None
        models = _effective_models(pid, entry, setting)
        result.append({
            "id": pid,
            "label": entry["label"],
            "enabled": bool(setting and setting["enabled"]) and available,
            "configured": _has_stored_key(setting) and available,
            "defaultModel": (setting["defaultModel"] if setting else None) or entry["defaultModel"],
            "baseUrl": setting["baseUrl"] if setting else None,
            "defaultBaseUrl": entry.get("defaultBaseUrl"),
            "models": models,
            "supportsAgent": entry["supportsAgent"] and available,
            "custom": entry.get("custom", False) or is_custom,
            "deletable": is_custom,
        })
    return result


def enabled_provider_info() -> list[dict]:
    return [p for p in list_provider_info() if p["enabled"] and p["configured"]]
