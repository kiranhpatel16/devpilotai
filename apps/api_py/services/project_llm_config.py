"""Per-project LLM defaults merged into workflow/agent AI calls."""

from __future__ import annotations

import json
from typing import Any

DEFAULT_LLM_CONFIG: dict[str, Any] = {
    "provider": None,
    "model": None,
    "planningProvider": None,
    "planningModel": None,
    "codingProvider": None,
    "codingModel": None,
    "maxTokens": 16384,
    "temperature": 0.2,
    "topP": None,
    "jsonMode": True,
    "maxRetries": None,
}


def _normalize_llm_config(cfg: dict[str, Any]) -> dict[str, Any]:
    if not cfg.get("planningProvider"):
        cfg["planningProvider"] = cfg.get("provider")
    if not cfg.get("planningModel"):
        cfg["planningModel"] = cfg.get("model")
    return cfg


def parse_llm_config(raw: dict | str | None) -> dict[str, Any]:
    if raw is None:
        return _normalize_llm_config(dict(DEFAULT_LLM_CONFIG))
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            return _normalize_llm_config(dict(DEFAULT_LLM_CONFIG))
    if not isinstance(raw, dict):
        return _normalize_llm_config(dict(DEFAULT_LLM_CONFIG))
    merged = dict(DEFAULT_LLM_CONFIG)
    for key in DEFAULT_LLM_CONFIG:
        if key in raw:
            merged[key] = raw[key]
    return _normalize_llm_config(merged)


def llm_config_to_json(cfg: dict | None) -> str:
    return json.dumps(parse_llm_config(cfg))


def llm_ctx_fields(cfg: dict) -> dict[str, Any]:
    """Keys consumed by ai_service.run_ai for generation parameters."""
    out: dict[str, Any] = {}
    if cfg.get("maxTokens") is not None:
        out["llmMaxTokens"] = cfg["maxTokens"]
    if cfg.get("temperature") is not None:
        out["llmTemperature"] = cfg["temperature"]
    if cfg.get("topP") is not None:
        out["llmTopP"] = cfg["topP"]
    if cfg.get("jsonMode") is not None:
        out["llmJsonMode"] = bool(cfg["jsonMode"])
    if cfg.get("maxRetries") is not None:
        out["maxRetries"] = cfg["maxRetries"]
    return out


def _default_coding_provider(cfg: dict[str, Any], enabled_ids: list[str] | None = None) -> str | None:
    if cfg.get("codingProvider"):
        return cfg["codingProvider"]
    if enabled_ids and "cursor" in enabled_ids:
        return "cursor"
    return cfg.get("planningProvider") or cfg.get("provider")


def _default_coding_model(cfg: dict[str, Any], provider: str | None) -> str | None:
    if cfg.get("codingModel"):
        return cfg["codingModel"]
    if provider == "cursor":
        return "composer-2.5"
    return cfg.get("planningModel") or cfg.get("model")


def resolve_planning_llm(
    run: dict,
    project: dict | None,
    *,
    detail: dict | None = None,
) -> dict[str, Any]:
    """Provider/model for requirement analysis, architecture, plan, test cases, review."""
    cfg = parse_llm_config((project or {}).get("llmConfig"))
    locked = bool((detail or {}).get("llmOverride"))

    if locked or detail is None:
        provider = run.get("provider") or cfg.get("planningProvider")
        model = run.get("model") or cfg.get("planningModel")
    else:
        provider = cfg.get("planningProvider") or run.get("provider")
        model = cfg.get("planningModel") or run.get("model")

    return {
        "provider": provider,
        "model": model,
        "ctxFields": llm_ctx_fields(cfg),
    }


def resolve_coding_llm(
    run: dict,
    project: dict | None,
    *,
    detail: dict | None = None,
    enabled_provider_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Provider/model for agent/code generation and deploy/test fixes."""
    cfg = parse_llm_config((project or {}).get("llmConfig"))
    wf = detail or {}

    if wf.get("codingProvider"):
        provider = wf["codingProvider"]
        model = wf.get("codingModel") or _default_coding_model(cfg, provider)
    else:
        provider = _default_coding_provider(cfg, enabled_provider_ids)
        model = _default_coding_model(cfg, provider)

    return {
        "provider": provider,
        "model": model,
        "ctxFields": llm_ctx_fields(cfg),
    }


def resolve_llm_for_run(
    run: dict,
    project: dict | None,
    *,
    detail: dict | None = None,
) -> dict[str, Any]:
    """Backward-compatible alias — returns planning LLM."""
    return resolve_planning_llm(run, project, detail=detail)


def merge_llm_into_ctx(
    ctx: dict,
    run: dict,
    project: dict | None,
    *,
    detail: dict | None = None,
    purpose: str = "planning",
    enabled_provider_ids: list[str] | None = None,
) -> dict:
    if purpose == "coding":
        llm = resolve_coding_llm(
            run, project, detail=detail, enabled_provider_ids=enabled_provider_ids,
        )
    else:
        llm = resolve_planning_llm(run, project, detail=detail)
    out = {**ctx, **llm["ctxFields"]}
    from services.ai_rules import attach_project_ai_rules

    return attach_project_ai_rules(
        out,
        run.get("projectId") or (project or {}).get("id"),
    )
