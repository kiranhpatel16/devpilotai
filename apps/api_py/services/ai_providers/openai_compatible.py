import httpx
from lib.errors import HttpError


def make_openai_compatible_adapter(provider_id: str, fallback_base_url: str):
    def _base(creds: dict) -> str:
        return (creds.get("baseUrl") or fallback_base_url).rstrip("/")

    async def chat(creds: dict, req: dict) -> dict:
        body = {
            "model": req["model"],
            "messages": [
                {"role": "system", "content": req["system"]},
                {"role": "user", "content": req["user"]},
            ],
            "temperature": 0.2,
        }
        if req.get("jsonMode"):
            body["response_format"] = {"type": "json_object"}

        url = f"{_base(creds)}/chat/completions"
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(
                    url,
                    json=body,
                    headers={
                        "Authorization": f"Bearer {creds['apiKey']}",
                        "Content-Type": "application/json",
                    },
                )
        except Exception as e:
            raise HttpError(502, f"Could not reach {provider_id} API", "ai_unreachable", {"cause": str(e)})

        if resp.status_code in (401, 403):
            raise HttpError(502, f"{provider_id} authentication failed. Check the API key.", "ai_auth_failed")
        if not resp.is_success:
            raise HttpError(502, f"{provider_id} request failed ({resp.status_code})", "ai_error",
                            {"body": resp.text[:600]})

        data = resp.json()
        content = data.get("choices", [{}])[0].get("message", {}).get("content", "") or ""
        return {
            "content": content,
            "inputTokens": data.get("usage", {}).get("prompt_tokens"),
            "outputTokens": data.get("usage", {}).get("completion_tokens"),
        }

    async def verify(creds: dict) -> None:
        await chat(creds, {
            "model": creds.get("defaultModel") or "gpt-4o-mini",
            "system": "ping",
            "user": "ping",
            "jsonMode": False,
        })

    return {"id": provider_id, "chat": chat, "verify": verify}
