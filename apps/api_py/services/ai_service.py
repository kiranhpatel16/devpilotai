import time
from services.agent_output_validator import validate_agent_output, validate_deploy_fix_output
from services.ai_providers.registry import get_adapter, resolve_creds
from services.ai_providers.normalize import normalize_agent_output
from services.prompt import build_prompt

MAX_AGENT_RETRIES = 3
MAX_DEPLOY_FIX_RETRIES = 5
VALIDATED_MODES = frozenset({"agent", "deploy_fix"})


async def run_ai(provider_id: str, model_override: str | None, ctx: dict) -> dict:
    resolved = resolve_creds(provider_id, model_override)
    creds = resolved["creds"]
    model = resolved["model"]
    adapter = get_adapter(provider_id)

    total_input_tokens = 0
    total_output_tokens = 0
    started = time.time()
    last_output: dict | None = None
    blocking_errors: list[str] = []
    warnings: list[str] = []

    max_retries = MAX_DEPLOY_FIX_RETRIES if ctx.get("mode") == "deploy_fix" else MAX_AGENT_RETRIES

    for attempt in range(max_retries + 1):
        attempt_ctx = dict(ctx)
        if blocking_errors:
            attempt_ctx["validationErrors"] = blocking_errors
            attempt_ctx["priorOutput"] = last_output

        prompt = build_prompt(attempt_ctx)
        result = await adapter["chat"](creds, {
            "system": prompt["system"],
            "user": prompt["user"],
            "model": model,
            "jsonMode": prompt["jsonMode"],
        })
        total_input_tokens += result.get("inputTokens") or 0
        total_output_tokens += result.get("outputTokens") or 0

        output = normalize_agent_output(result["content"])
        last_output = output

        if ctx.get("mode") not in VALIDATED_MODES:
            break

        cwd = ctx.get("cwd")
        if not cwd:
            break

        validation = (
            validate_deploy_fix_output(
                cwd,
                output,
                ctx.get("deployAnalysis") or {},
                php_bin=ctx.get("phpBin") or "php",
                docker_compose_path=ctx.get("dockerComposePath"),
            )
            if ctx.get("mode") == "deploy_fix"
            else validate_agent_output(cwd, output)
        )
        blocking_errors = validation["blocking"]
        warnings = validation["warnings"]

        if not blocking_errors:
            break

        if attempt < max_retries:
            continue

    latency_ms = int((time.time() - started) * 1000)
    final_output = last_output or {
        "summary": "", "files": [], "manualTestChecklist": [], "risks": [], "text": "",
    }
    if warnings:
        final_output["validationWarnings"] = warnings
    if blocking_errors:
        final_output["validationErrors"] = blocking_errors

    return {
        "output": final_output,
        "usage": {
            "provider": provider_id,
            "model": model,
            "inputTokens": total_input_tokens or None,
            "outputTokens": total_output_tokens or None,
            "latencyMs": latency_ms,
        },
        "validation": {
            "blocking": blocking_errors,
            "warnings": warnings,
        },
    }
