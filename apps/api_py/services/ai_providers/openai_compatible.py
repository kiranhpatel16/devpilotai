import asyncio
import httpx
from lib.errors import HttpError

# Agent/refine calls can return large multi-file JSON (100k+ tokens). Match frontend longRequest (10 min).
DEFAULT_AI_TIMEOUT = httpx.Timeout(connect=30.0, read=600.0, write=120.0, pool=30.0)
NETWORK_RETRY_ATTEMPTS = 3
NETWORK_RETRY_BACKOFF_SEC = 2.0


def _network_error_message(provider_id: str, exc: Exception) -> str:
    if isinstance(exc, httpx.TimeoutException):
        return (
            f"{provider_id} API request timed out. Large refine/agent responses can take several "
            "minutes — retrying usually works. If this persists, use a faster model or shorten the task."
        )
    if isinstance(exc, httpx.ConnectError):
        return (
            f"Could not connect to {provider_id} API. Check base URL, network, and firewall settings."
        )
    return f"Could not reach {provider_id} API"


async def _post_with_retries(url: str, *, json: dict, headers: dict, provider_id: str) -> httpx.Response:
    last_exc: Exception | None = None
    for attempt in range(NETWORK_RETRY_ATTEMPTS):
        try:
            async with httpx.AsyncClient(timeout=DEFAULT_AI_TIMEOUT, trust_env=True) as client:
                return await client.post(url, json=json, headers=headers)
        except (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError) as exc:
            last_exc = exc
            if attempt + 1 >= NETWORK_RETRY_ATTEMPTS:
                break
            await asyncio.sleep(NETWORK_RETRY_BACKOFF_SEC * (attempt + 1))
    assert last_exc is not None
    raise HttpError(
        502,
        _network_error_message(provider_id, last_exc),
        "ai_unreachable",
        {"cause": str(last_exc), "type": type(last_exc).__name__},
    )


def _api_error_message(provider_id: str, resp: httpx.Response) -> str:
    try:
        data = resp.json()
        if isinstance(data, dict):
            err = data.get("error")
            if isinstance(err, str) and err:
                return f"{provider_id} API error: {err}"
            if isinstance(err, dict) and err.get("message"):
                return f'{provider_id} API error: {err["message"]}'
            msg = data.get("message")
            if isinstance(msg, str) and msg:
                return f"{provider_id} API error: {msg}"
    except Exception:
        pass
    snippet = resp.text.strip()[:240]
    if snippet:
        return f"{provider_id} request failed ({resp.status_code}): {snippet}"
    return f"{provider_id} request failed ({resp.status_code})"


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
            "temperature": req.get("temperature") if req.get("temperature") is not None else 0.2,
        }
        if req.get("maxTokens") is not None:
            body["max_tokens"] = req["maxTokens"]
        if req.get("topP") is not None:
            body["top_p"] = req["topP"]
        if req.get("jsonMode"):
            body["response_format"] = {"type": "json_object"}

        url = f"{_base(creds)}/chat/completions"
        try:
            resp = await _post_with_retries(
                url,
                json=body,
                headers={
                    "Authorization": f"Bearer {creds['apiKey']}",
                    "Content-Type": "application/json",
                },
                provider_id=provider_id,
            )
        except HttpError:
            raise
        except Exception as e:
            raise HttpError(
                502,
                _network_error_message(provider_id, e),
                "ai_unreachable",
                {"cause": str(e), "type": type(e).__name__},
            )

        if resp.status_code in (401, 403):
            raise HttpError(502, f"{provider_id} authentication failed. Check the API key.", "ai_auth_failed")
        if not resp.is_success:
            raise HttpError(502, _api_error_message(provider_id, resp), "ai_error",
                            {"body": resp.text[:600]})

        data = resp.json()
        choice = data.get("choices", [{}])[0]
        content = choice.get("message", {}).get("content", "") or ""
        finish_reason = choice.get("finish_reason")
        return {
            "content": content,
            "inputTokens": data.get("usage", {}).get("prompt_tokens"),
            "outputTokens": data.get("usage", {}).get("completion_tokens"),
            "finishReason": finish_reason,
        }

    async def verify(creds: dict) -> None:
        await chat(creds, {
            "model": creds.get("defaultModel") or "gpt-4o-mini",
            "system": "ping",
            "user": "ping",
            "jsonMode": False,
        })

    return {"id": provider_id, "chat": chat, "verify": verify}
