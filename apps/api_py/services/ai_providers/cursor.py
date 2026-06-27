"""Cursor SDK provider — local agent execution for the Coding step."""

from __future__ import annotations

import asyncio
import os

from cursor_sdk import Agent, AgentOptions, Cursor, CursorAgentError, LocalAgentOptions
from lib.errors import HttpError


def _build_prompt(req: dict) -> str:
    system = (req.get("system") or "").strip()
    user = (req.get("user") or "").strip()
    if system and user:
        return f"{system}\n\n---\n\n{user}"
    return system or user


def _agent_options(creds: dict, req: dict) -> AgentOptions:
    cwd = req.get("cwd") or os.getcwd()
    return AgentOptions(
        api_key=creds["apiKey"],
        model=req["model"],
        local=LocalAgentOptions(cwd=cwd, setting_sources=[]),
    )


def _chat_sync(creds: dict, req: dict) -> dict:
    try:
        result = Agent.prompt(_build_prompt(req), _agent_options(creds, req))
    except CursorAgentError as err:
        raise HttpError(
            502,
            f"Cursor SDK startup failed: {err.message}",
            "ai_error",
            {"retryable": err.is_retryable},
        ) from err

    if result.status == "error":
        detail = (result.result or "").strip()[:400]
        msg = f"Cursor SDK run failed{': ' + detail if detail else ''}"
        raise HttpError(502, msg, "ai_error", {"runId": result.id})

    content = result.result or ""
    return {
        "content": content,
        "inputTokens": None,
        "outputTokens": None,
        "finishReason": result.status,
    }


def _verify_sync(creds: dict) -> None:
    try:
        models = Cursor.models.list(api_key=creds["apiKey"])
    except CursorAgentError as err:
        raise HttpError(
            502,
            f"Cursor SDK authentication failed: {err.message}",
            "ai_auth_failed",
        ) from err
    if not models:
        raise HttpError(502, "Cursor SDK returned no models for this API key.", "ai_auth_failed")


async def _chat(creds: dict, req: dict) -> dict:
    return await asyncio.to_thread(_chat_sync, creds, req)


async def _verify(creds: dict) -> None:
    await asyncio.to_thread(_verify_sync, creds)


cursor_adapter = {"id": "cursor", "chat": _chat, "verify": _verify}
