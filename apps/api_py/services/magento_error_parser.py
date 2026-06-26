"""Extract Magento storefront exception details from HTML error pages."""

from __future__ import annotations

import re
from html import unescape
from typing import Any

_EXCEPTION_RE = re.compile(
    r"Exception\s+#\d+\s*\(([^)]+)\):\s*([^\n<]+)",
    re.IGNORECASE,
)
_FILE_ABS_RE = re.compile(
    r"(/var/www/html/)?(app/(?:code|design)/[^\s'\"<>]+\.(?:xml|php|phtml))",
    re.IGNORECASE,
)
_LINE_RE = re.compile(r"Line:\s*(\d+)", re.IGNORECASE)
_DETAIL_LINE_RE = re.compile(r"^([^\n]+)\s+Line:\s*(\d+)", re.IGNORECASE | re.MULTILINE)


def _strip_html(text: str) -> str:
    cleaned = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    cleaned = re.sub(r"<[^>]+>", " ", cleaned)
    cleaned = unescape(cleaned)
    cleaned = re.sub(r"[ \t]+", " ", cleaned)
    return cleaned.strip()


def parse_magento_storefront_error(html: str) -> dict[str, Any] | None:
    """Parse Magento exception blocks from an HTTP error page body."""
    if not html or "exception" not in html.lower():
        return None

    text = _strip_html(html)
    if "exception" not in text.lower():
        return None

    exc_match = _EXCEPTION_RE.search(text)
    message = exc_match.group(2).strip() if exc_match else None
    exc_type = exc_match.group(1).strip() if exc_match else None

    file_match = _FILE_ABS_RE.search(text)
    rel_file: str | None = None
    if file_match:
        rel_file = file_match.group(2).lstrip("/")

    line: int | None = None
    line_match = _LINE_RE.search(text)
    if line_match:
        line = int(line_match.group(1))

    details: list[str] = []
    for detail_match in _DETAIL_LINE_RE.finditer(text):
        detail_msg = detail_match.group(1).strip()
        if detail_msg and detail_msg not in details:
            details.append(detail_msg)
        if line is None:
            line = int(detail_match.group(2))

    if not message and not rel_file and not details:
        return None

    return {
        "type": exc_type,
        "message": message or (details[0] if details else "Storefront error"),
        "file": rel_file,
        "line": line,
        "details": details[:6],
    }
