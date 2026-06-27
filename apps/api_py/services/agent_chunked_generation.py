"""Chunked developer-agent runs with progress and token-limit continuation."""

from __future__ import annotations

import re
from db.ai_settings import run_usage_repo
from services.ai_service import run_ai
from services.git_service import repair_file_changes
from services.run_detail import patch_detail

MAX_CONTINUATIONS_PER_CHUNK = 4
DEFAULT_TASKS_PER_CHUNK = 3


def _format_plan_tasks(tasks: list[dict]) -> str:
    lines = ["Implement ONLY these plan tasks in this chunk:"]
    for t in tasks:
        title = (t.get("title") or "").strip()
        file_hint = t.get("file")
        mins = t.get("estimatedMinutes")
        suffix = ""
        if file_hint:
            suffix += f" (file: `{file_hint}`)"
        if mins:
            suffix += f" — ~{mins} min"
        lines.append(f"- {title}{suffix}")
    return "\n".join(lines)


def split_plan_into_chunks(
    plan_markdown: str,
    plan_tasks: list[dict] | None,
    *,
    tasks_per_chunk: int = DEFAULT_TASKS_PER_CHUNK,
) -> list[str]:
    if plan_tasks:
        chunks: list[str] = []
        batch: list[dict] = []
        for task in plan_tasks:
            batch.append(task)
            if len(batch) >= tasks_per_chunk:
                chunks.append(_format_plan_tasks(batch))
                batch = []
        if batch:
            chunks.append(_format_plan_tasks(batch))
        if chunks:
            return chunks

    text = (plan_markdown or "").strip()
    if not text:
        return ["Implement the approved development plan."]

    sections = re.split(r"\n(?=#{1,3}\s)", text)
    sections = [s.strip() for s in sections if s.strip()]
    if len(sections) <= 1:
        return [text[:12000]]

    chunks: list[str] = []
    batch: list[str] = []
    batch_len = 0
    for section in sections:
        if batch and batch_len + len(section) > 9000:
            chunks.append("\n\n".join(batch))
            batch = [section]
            batch_len = len(section)
        else:
            batch.append(section)
            batch_len += len(section)
    if batch:
        chunks.append("\n\n".join(batch))
    return chunks or [text[:12000]]


def merge_agent_outputs(base: dict | None, new: dict) -> dict:
    base = base or {"summary": "", "files": [], "manualTestChecklist": [], "risks": [], "text": ""}
    by_path: dict[str, dict] = {}
    for f in base.get("files") or []:
        path = f.get("path")
        if path:
            by_path[path] = f
    for f in new.get("files") or []:
        path = f.get("path")
        if path:
            by_path[path] = f
    checklists = list(base.get("manualTestChecklist") or [])
    for item in new.get("manualTestChecklist") or []:
        if item not in checklists:
            checklists.append(item)
    risks = list(base.get("risks") or [])
    for r in new.get("risks") or []:
        if r not in risks:
            risks.append(r)
    return {
        "summary": new.get("summary") or base.get("summary") or "",
        "files": list(by_path.values()),
        "manualTestChecklist": checklists,
        "risks": risks,
        "text": new.get("text") or base.get("text") or "",
    }


def _progress_payload(
    *,
    status: str,
    current: int,
    total: int,
    label: str,
    files_generated: int,
    chunks: list[dict],
) -> dict:
    return {
        "status": status,
        "currentChunk": current,
        "totalChunks": total,
        "chunkLabel": label,
        "filesGenerated": files_generated,
        "chunks": chunks,
    }


async def _run_chunk_with_continuations(
    provider: str,
    model: str | None,
    base_ctx: dict,
    *,
    chunk_plan: str,
    prior_output: dict | None,
) -> tuple[dict, dict]:
    """Run one plan chunk; continue if the model hits max output tokens."""
    cumulative = prior_output
    total_usage = {"inputTokens": 0, "outputTokens": 0, "latencyMs": 0}

    for attempt in range(MAX_CONTINUATIONS_PER_CHUNK):
        ctx = dict(base_ctx)
        ctx["approvedPlanMarkdown"] = chunk_plan
        extra = (
            "\n\nReturn a COMPLETE JSON proposal for this chunk only. "
            "Include full file contents — no placeholders."
        )
        if cumulative and (cumulative.get("files") or []):
            ctx["priorOutput"] = cumulative
            file_list = ", ".join(f["path"] for f in cumulative.get("files") or [] if f.get("path"))
            extra = (
                f"\n\nFiles already generated in prior chunks: {file_list}\n"
                "Continue with ANY remaining files from this chunk's plan tasks. "
                "Do not repeat completed files unless fixing them. Return complete JSON."
            )
        if attempt > 0:
            extra += "\n\nYour previous response was truncated by token limits — continue where you left off."

        ctx["userInstructions"] = (ctx.get("userInstructions") or "") + extra

        result = await run_ai(provider, model, ctx)
        usage = result.get("usage") or {}
        total_usage["inputTokens"] = (total_usage["inputTokens"] or 0) + (usage.get("inputTokens") or 0)
        total_usage["outputTokens"] = (total_usage["outputTokens"] or 0) + (usage.get("outputTokens") or 0)
        total_usage["latencyMs"] = (total_usage["latencyMs"] or 0) + (usage.get("latencyMs") or 0)

        chunk_out = result["output"]
        cwd = base_ctx.get("cwd")
        if cwd:
            chunk_out = dict(chunk_out)
            chunk_out["files"] = repair_file_changes(cwd, chunk_out.get("files") or [])

        cumulative = merge_agent_outputs(cumulative, chunk_out)

        if result.get("finishReason") != "length":
            break

    return cumulative or {"summary": "", "files": [], "manualTestChecklist": [], "risks": [], "text": ""}, total_usage


async def run_chunked_agent(
    run_id: str,
    provider: str,
    model: str | None,
    ctx: dict,
    *,
    plan_markdown: str,
    plan_tasks: list[dict] | None,
) -> dict:
    chunks = split_plan_into_chunks(plan_markdown, plan_tasks)
    total = len(chunks)
    chunk_states = [
        {"index": i + 1, "label": f"Part {i + 1} of {total}", "status": "pending", "fileCount": 0}
        for i in range(total)
    ]

    def save_progress(current: int, label: str, files_count: int, status: str = "running") -> None:
        states = []
        for i, ch in enumerate(chunk_states):
            st = dict(ch)
            if i + 1 < current:
                st["status"] = "complete"
            elif i + 1 == current:
                st["status"] = "running" if status == "running" else st.get("status", "running")
            states.append(st)
        patch_detail(run_id, {
            "agentGeneration": _progress_payload(
                status=status,
                current=current,
                total=total,
                label=label,
                files_generated=files_count,
                chunks=states,
            ),
        })

    save_progress(1, chunk_states[0]["label"], 0)
    cumulative: dict | None = None
    agg_usage = {"provider": provider, "model": model, "inputTokens": 0, "outputTokens": 0, "latencyMs": 0}

    for idx, chunk_plan in enumerate(chunks, start=1):
        label = chunk_states[idx - 1]["label"]
        save_progress(idx, label, len(cumulative.get("files") or []) if cumulative else 0)

        chunk_out, chunk_usage = await _run_chunk_with_continuations(
            provider,
            model,
            ctx,
            chunk_plan=chunk_plan,
            prior_output=cumulative,
        )
        cumulative = merge_agent_outputs(cumulative, chunk_out)
        chunk_states[idx - 1]["status"] = "complete"
        chunk_states[idx - 1]["fileCount"] = len(chunk_out.get("files") or [])

        agg_usage["inputTokens"] = (agg_usage["inputTokens"] or 0) + (chunk_usage.get("inputTokens") or 0)
        agg_usage["outputTokens"] = (agg_usage["outputTokens"] or 0) + (chunk_usage.get("outputTokens") or 0)
        agg_usage["latencyMs"] = (agg_usage["latencyMs"] or 0) + (chunk_usage.get("latencyMs") or 0)

        run_usage_repo.record(run_id, {
            "provider": provider,
            "model": model,
            "inputTokens": chunk_usage.get("inputTokens"),
            "outputTokens": chunk_usage.get("outputTokens"),
            "latencyMs": chunk_usage.get("latencyMs"),
        })

        patch_detail(run_id, {
            "agentGeneration": _progress_payload(
                status="running",
                current=idx,
                total=total,
                label=label,
                files_generated=len(cumulative.get("files") or []),
                chunks=chunk_states,
            ),
            "output": cumulative,
            "usage": {
                "provider": provider,
                "model": model,
                **agg_usage,
            },
        })

    patch_detail(run_id, {
        "agentGeneration": _progress_payload(
            status="complete",
            current=total,
            total=total,
            label="Complete",
            files_generated=len(cumulative.get("files") or []) if cumulative else 0,
            chunks=[{**c, "status": "complete"} for c in chunk_states],
        ),
        "usage": {
            "provider": provider,
            "model": model,
            **agg_usage,
        },
    })

    return {
        "output": cumulative or {"summary": "", "files": [], "manualTestChecklist": [], "risks": [], "text": ""},
        "usage": agg_usage,
        "validation": {"blocking": cumulative.get("validationErrors") or [], "warnings": cumulative.get("validationWarnings") or []},
    }
