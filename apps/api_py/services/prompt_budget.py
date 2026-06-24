"""Keep AI prompts within model context limits."""

from __future__ import annotations

MAX_DEPLOY_OUTPUT_CHARS = 5_000
MAX_PLAN_CHARS = 4_000
MAX_JIRA_DESCRIPTION_CHARS = 3_000
MAX_DEPLOY_FIX_FILES = 8
MAX_DEPLOY_FIX_CHARS_PER_FILE = 2_500
MAX_DEPLOY_FIX_TOTAL_CHARS = 18_000
MAX_AGENT_EXCERPT_CHARS = 3_500
MAX_AGENT_EXCERPT_FILES = 14


def trim_text(text: str | None, max_chars: int) -> str:
    if not text:
        return ""
    text = text.strip()
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 40] + "\n\n…(truncated for context limit)…"


def trim_excerpts(
    excerpts: list[dict],
    *,
    max_files: int = MAX_DEPLOY_FIX_FILES,
    max_per_file: int = MAX_DEPLOY_FIX_CHARS_PER_FILE,
    max_total: int = MAX_DEPLOY_FIX_TOTAL_CHARS,
) -> list[dict]:
    trimmed: list[dict] = []
    total = 0
    for item in excerpts[:max_files]:
        path = item.get("path", "")
        content = trim_text(item.get("content") or "", max_per_file)
        if not path or not content:
            continue
        if total + len(content) > max_total:
            remaining = max_total - total
            if remaining < 500:
                break
            content = trim_text(content, remaining)
        trimmed.append({"path": path, "content": content})
        total += len(content)
    return trimmed
