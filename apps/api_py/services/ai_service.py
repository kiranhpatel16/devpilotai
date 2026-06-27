import time
from services.agent_output_validator import (
    validate_agent_output,
    validate_deploy_fix_output,
    validate_test_fix_output,
    paths_from_blocking_errors,
)
from services.ai_providers.registry import get_adapter, resolve_creds
from services.ai_providers.normalize import normalize_agent_output
from services.prompt import build_prompt

MAX_AGENT_RETRIES = 5
MAX_DEPLOY_FIX_RETRIES = 5
VALIDATED_MODES = frozenset({"agent", "deploy_fix", "test_fix"})


async def run_ai(provider_id: str, model_override: str | None, ctx: dict) -> dict:
    resolved = resolve_creds(provider_id, model_override)
    creds = resolved["creds"]
    model = resolved["model"]
    adapter = get_adapter(provider_id)

    total_input_tokens = 0
    total_output_tokens = 0
    finish_reason = None
    started = time.time()
    last_output: dict | None = None
    blocking_errors: list[str] = []
    warnings: list[str] = []

    max_retries = ctx.get("maxRetries")
    if max_retries is None:
        max_retries = (
            MAX_DEPLOY_FIX_RETRIES
            if ctx.get("mode") in ("deploy_fix", "test_fix")
            else (2 if ctx.get("refineInstructions") else MAX_AGENT_RETRIES)
        )

    is_refine = bool((ctx.get("refineInstructions") or "").strip())
    original_prior = ctx.get("priorOutput")

    for attempt in range(max_retries + 1):
        attempt_ctx = dict(ctx)
        if blocking_errors:
            attempt_ctx["validationErrors"] = blocking_errors
            # During refine, keep the original proposal in the prompt so retries
            # still see the full file list — only auto-retries replace priorOutput.
            if not is_refine:
                attempt_ctx["priorOutput"] = last_output

        prompt = build_prompt(attempt_ctx)
        chat_req = {
            "system": prompt["system"],
            "user": prompt["user"],
            "model": model,
            "jsonMode": prompt["jsonMode"],
        }
        if ctx.get("cwd"):
            chat_req["cwd"] = ctx["cwd"]
        if ctx.get("llmMaxTokens") is not None:
            chat_req["maxTokens"] = ctx["llmMaxTokens"]
        if ctx.get("llmTemperature") is not None:
            chat_req["temperature"] = ctx["llmTemperature"]
        if ctx.get("llmTopP") is not None:
            chat_req["topP"] = ctx["llmTopP"]
        if ctx.get("llmJsonMode") is not None and prompt["jsonMode"]:
            chat_req["jsonMode"] = bool(ctx["llmJsonMode"])
        result = await adapter["chat"](creds, chat_req)
        total_input_tokens += result.get("inputTokens") or 0
        total_output_tokens += result.get("outputTokens") or 0
        finish_reason = result.get("finishReason")

        output = normalize_agent_output(result["content"])
        cwd = ctx.get("cwd")
        if cwd:
            from services.git_service import repair_file_changes, merge_refined_files

            new_files = repair_file_changes(cwd, output.get("files") or [])
            validation_errors = attempt_ctx.get("validationErrors") or []
            merge_base = original_prior if is_refine else attempt_ctx.get("priorOutput")
            if merge_base and ctx.get("mode") == "agent" and validation_errors:
                new_files = merge_refined_files(
                    merge_base.get("files") or [],
                    new_files,
                    broken_paths=paths_from_blocking_errors(validation_errors),
                )
                new_files = repair_file_changes(cwd, new_files)
            output["files"] = new_files
        last_output = output

        if ctx.get("mode") not in VALIDATED_MODES:
            break

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
            else (
                validate_test_fix_output(
                    cwd,
                    output,
                    ctx.get("testAnalysis") or {},
                    php_bin=ctx.get("phpBin") or "php",
                    docker_compose_path=ctx.get("dockerComposePath"),
                )
                if ctx.get("mode") == "test_fix"
                else validate_agent_output(cwd, output)
            )
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
        "finishReason": finish_reason,
        "validation": {
            "blocking": blocking_errors,
            "warnings": warnings,
        },
    }
