"""Preserve useful error context from long CLI output (Magento compile, composer, etc.)."""

from __future__ import annotations

import re

_ERROR_MARKERS = [
    re.compile(p, re.IGNORECASE)
    for p in (
        r"There is an error in",
        r"Fatal error",
        r"Parse error",
        r"syntax error",
        r"Uncaught ",
        r"Invalid XML",
        r"Module '[^']+' is not",
        r"Could not find package",
        r"Your requirements could not be resolved",
        r"COMPOSER",
        r"Exception:",
        r"Error:",
    )
]


def _merge_spans(spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    if not spans:
        return []
    spans = sorted(spans)
    merged: list[tuple[int, int]] = [spans[0]]
    for start, end in spans[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end + 80:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged


def summarize_command_output(
    stdout: str,
    stderr: str,
    *,
    ok: bool,
    max_chars: int = 12_000,
) -> str:
    """Keep failure diagnostics when Magento/compose output is mostly progress noise."""
    combined = (stdout or "") + (stderr or "")
    if not combined:
        return ""
    if ok:
        return combined[-max_chars:] if len(combined) > max_chars else combined

    if len(combined) <= max_chars:
        return combined

    spans: list[tuple[int, int]] = []
    offset = 0
    for line in combined.splitlines(keepends=True):
        if any(marker.search(line) for marker in _ERROR_MARKERS):
            spans.append((max(0, offset - 120), min(len(combined), offset + len(line) + 1800)))
        offset += len(line)

    spans.append((max(0, len(combined) - 3500), len(combined)))
    spans = _merge_spans(spans)

    parts: list[str] = []
    used = 0
    separator = "\n\n--- output excerpt ---\n\n"
    for idx, (start, end) in enumerate(spans):
        chunk = combined[start:end].strip()
        if not chunk:
            continue
        prefix = separator if parts else ""
        budget = max_chars - used - len(prefix)
        if budget < 400:
            break
        if len(chunk) > budget:
            chunk = chunk[: budget - 30] + "\n…(truncated)…"
        parts.append(prefix + chunk)
        used += len(prefix) + len(chunk)

    return "".join(parts) if parts else combined[-max_chars:]
