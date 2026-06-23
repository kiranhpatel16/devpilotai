import time
from services.ai_providers.registry import get_adapter, resolve_creds
from services.ai_providers.normalize import normalize_agent_output
from services.prompt import build_prompt


async def run_ai(provider_id: str, model_override: str | None, ctx: dict) -> dict:
    resolved = resolve_creds(provider_id, model_override)
    creds = resolved["creds"]
    model = resolved["model"]
    adapter = get_adapter(provider_id)
    prompt = build_prompt(ctx)

    started = time.time()
    result = await adapter["chat"](creds, {
        "system": prompt["system"],
        "user": prompt["user"],
        "model": model,
        "jsonMode": prompt["jsonMode"],
    })
    latency_ms = int((time.time() - started) * 1000)

    output = normalize_agent_output(result["content"])
    return {
        "output": output,
        "usage": {
            "provider": provider_id,
            "model": model,
            "inputTokens": result.get("inputTokens"),
            "outputTokens": result.get("outputTokens"),
            "latencyMs": latency_ms,
        },
    }
