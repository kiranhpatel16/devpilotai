import httpx
from urllib.parse import quote
from lib.errors import HttpError
from services.ai_providers.openai_compatible import _network_error_message, _post_with_retries

FALLBACK_BASE = "https://generativelanguage.googleapis.com/v1beta"


async def _chat(creds: dict, req: dict) -> dict:
    base = (creds.get("baseUrl") or FALLBACK_BASE).rstrip("/")
    model = quote(req["model"])
    url = f"{base}/models/{model}:generateContent?key={creds['apiKey']}"

    body = {
        "systemInstruction": {"parts": [{"text": req["system"]}]},
        "contents": [{"role": "user", "parts": [{"text": req["user"]}]}],
        "generationConfig": {
            "temperature": 0.2,
            **({"responseMimeType": "application/json"} if req.get("jsonMode") else {}),
        },
    }

    try:
        resp = await _post_with_retries(
            url,
            json=body,
            headers={"Content-Type": "application/json"},
            provider_id="cloud_ai",
        )
    except HttpError:
        raise
    except Exception as e:
        raise HttpError(
            502,
            _network_error_message("cloud_ai", e),
            "ai_unreachable",
            {"cause": str(e), "type": type(e).__name__},
        )

    if resp.status_code in (401, 403):
        raise HttpError(502, "Gemini authentication failed. Check the API key.", "ai_auth_failed")
    if not resp.is_success:
        raise HttpError(502, f"Gemini request failed ({resp.status_code})", "ai_error",
                        {"body": resp.text[:600]})

    data = resp.json()
    parts = data.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    content = "".join(p.get("text", "") for p in parts)
    return {
        "content": content,
        "inputTokens": data.get("usageMetadata", {}).get("promptTokenCount"),
        "outputTokens": data.get("usageMetadata", {}).get("candidatesTokenCount"),
    }


async def _verify(creds: dict) -> None:
    await _chat(creds, {
        "system": "ping",
        "user": "ping",
        "model": creds.get("defaultModel") or "gemini-2.0-flash",
        "jsonMode": False,
    })


gemini_adapter = {"id": "cloud_ai", "chat": _chat, "verify": _verify}
