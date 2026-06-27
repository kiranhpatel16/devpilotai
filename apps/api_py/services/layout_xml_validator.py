"""Validate Magento layout/theme XML before deploy and QA."""

from __future__ import annotations

import os
import re
import xml.etree.ElementTree as ET

_AMPERSAND_RE = re.compile(r"&(?!amp;|lt;|gt;|apos;|quot;|#\d+;|#x[0-9a-fA-F]+;)")


def is_layout_xml_path(path: str) -> bool:
    p = path.replace("\\", "/").lower()
    if not p.endswith(".xml"):
        return False
    return "/layout/" in p or "/page_layout/" in p


def validate_layout_xml_content(content: str, path: str = "") -> list[str]:
    errors: list[str] = []
    label = path or "layout XML"
    if not (content or "").strip():
        return [f"{label}: file is empty"]

    for line_no, line in enumerate(content.splitlines(), 1):
        if _AMPERSAND_RE.search(line):
            errors.append(
                f"Line {line_no}: unescaped '&' — use &amp; in XML attributes and URLs "
                f"(EntityRef errors on the storefront often come from this)."
            )

    try:
        ET.fromstring(content)
    except ET.ParseError as exc:
        errors.append(f"Invalid XML: {exc}")

    return errors


def validate_layout_xml_files(cwd: str, paths: list[str]) -> tuple[bool, str]:
    layout_paths = [p for p in paths if is_layout_xml_path(p)]
    if not layout_paths:
        return True, "No layout XML files to validate."

    lines: list[str] = []
    ok = True
    for rel in layout_paths:
        abs_path = os.path.join(cwd, rel)
        if not os.path.isfile(abs_path):
            lines.append(f"{rel}: file not found on disk")
            ok = False
            continue
        try:
            with open(abs_path, encoding="utf-8", errors="replace") as handle:
                content = handle.read()
        except OSError as exc:
            lines.append(f"{rel}: could not read file ({exc})")
            ok = False
            continue
        file_errors = validate_layout_xml_content(content, rel)
        if file_errors:
            ok = False
            for err in file_errors:
                lines.append(f"{rel}: {err}")
        else:
            lines.append(f"{rel}: OK")

    return ok, "\n".join(lines)
