"""Extract Magento storefront exception details from HTML error pages."""

from __future__ import annotations

import re
from html import unescape
from typing import Any

THEME_LAYOUT_FILE_RE = re.compile(
    r"layout update file\s+'(?:/var/www/html/)?([^']+\.xml)'",
    re.IGNORECASE,
)
_LAYOUT_HEAD_ELEMENT_RE = re.compile(
    r"Element '(script|noscript|link|meta|css|title|remove|attribute|font)'",
    re.IGNORECASE,
)

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

    layout_file = _layout_file_from_text(text)

    return {
        "type": exc_type,
        "message": message or (details[0] if details else "Storefront error"),
        "file": layout_file or rel_file,
        "line": line,
        "details": details[:6],
        "stackFile": rel_file if layout_file and rel_file != layout_file else None,
    }


def _layout_file_from_text(text: str) -> str | None:
    match = THEME_LAYOUT_FILE_RE.search(text)
    if not match:
        return None
    return match.group(1).lstrip("/").replace("\\", "/")


def is_layout_head_dom_validation_error(text: str, parsed: dict[str, Any] | None = None) -> bool:
    """True when Magento head/layout XML is invalid (script src, noscript, etc.)."""
    blob = (text or "").lower()
    exc_type = ((parsed or {}).get("type") or "").lower()
    if "config\\dom\\validationexception" in exc_type or "config/dom/validationexception" in blob:
        if _LAYOUT_HEAD_ELEMENT_RE.search(text or ""):
            return True
        if "layout update file" in blob:
            return True
    if "storefront error" in blob and _LAYOUT_HEAD_ELEMENT_RE.search(text or ""):
        return True
    if any(
        phrase in blob
        for phrase in (
            "element 'script'",
            "element 'noscript'",
            "expected is one of ( title, css, link, meta, script",
        )
    ):
        return True
    return False


def parse_storefront_error_text(text: str) -> dict[str, Any] | None:
    """Parse formatted storefront probe output (plain text, not HTML)."""
    if not text or "exception" not in text.lower():
        return None

    exc_type: str | None = None
    type_match = re.search(r"Exception:\s*([^\n]+)", text, re.IGNORECASE)
    if type_match:
        exc_type = type_match.group(1).strip()

    message: str | None = None
    details: list[str] = []
    rel_file: str | None = None
    line: int | None = None

    for raw_line in text.splitlines():
        stripped = raw_line.strip()
        if stripped.startswith("• "):
            detail = stripped[2:].strip()
            if detail and detail not in details:
                details.append(detail)
            continue
        if stripped.startswith("Exception #"):
            if stripped not in details:
                details.append(stripped)
            continue
        file_match = re.match(
            r"File:\s+((?:/var/www/html/)?(app/(?:code|design)/[^\s]+))\s*(?:\(line\s+(\d+)\))?",
            stripped,
            re.IGNORECASE,
        )
        if file_match:
            rel_file = file_match.group(1).lstrip("/").replace("\\", "/")
            if file_match.group(3):
                line = int(file_match.group(3))
            continue
        if (
            not message
            and stripped
            and not stripped.lower().startswith("http ")
            and not stripped.lower().startswith("exception:")
        ):
            message = stripped

    layout_file = _layout_file_from_text(text)
    stack_file: str | None = None
    if layout_file:
        for raw_line in text.splitlines():
            file_match = re.match(
                r"File:\s+((?:/var/www/html/)?(app/code/[^\s]+))\s*(?:\(line\s+(\d+)\))?",
                raw_line.strip(),
                re.IGNORECASE,
            )
            if file_match:
                candidate = file_match.group(1).lstrip("/").replace("\\", "/")
                if candidate != layout_file:
                    stack_file = candidate
                    break
        rel_file = layout_file
    elif is_layout_head_dom_validation_error(text) and rel_file and rel_file.endswith(".php"):
        stack_file = rel_file
        rel_file = None

    if not message and not rel_file and not details:
        return None

    return {
        "type": exc_type,
        "message": message or (details[0] if details else "Storefront error"),
        "file": rel_file,
        "line": line,
        "details": details[:6],
        "stackFile": stack_file,
    }
