"""Detect and fix invalid inline <script>/<noscript> in Magento head layout XML."""

from __future__ import annotations

import os
import re
from typing import Any

from services.layout_xml_validator import is_layout_xml_path, validate_layout_xml_content

_INLINE_SCRIPT_BLOCK_RE = re.compile(
    r"<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?</script>",
    re.IGNORECASE,
)
_NOSCRIPT_BLOCK_RE = re.compile(
    r"<noscript\b[^>]*>[\s\S]*?</noscript>",
    re.IGNORECASE,
)
_TRACKING_NAME_RE = re.compile(
    r"<!--\s*([^<\n]+?(?:pixel|tag|tracking|gtm|analytics)[^<\n]*)\s*-->",
    re.IGNORECASE,
)
_MODULE_FROM_LAYOUT_RE = re.compile(
    r"app/design/frontend/[^/]+/[^/]+/([^/]+)/layout/",
    re.IGNORECASE,
)


def layout_has_invalid_head_tags(content: str) -> bool:
    if not content:
        return False
    return bool(_INLINE_SCRIPT_BLOCK_RE.search(content) or _NOSCRIPT_BLOCK_RE.search(content))


def magento_head_layout_errors(content: str, path: str = "") -> list[str]:
    """Magento-specific head layout rules beyond well-formed XML."""
    errors: list[str] = []
    label = path or "layout XML"
    if _INLINE_SCRIPT_BLOCK_RE.search(content or ""):
        errors.append(
            f"{label}: inline <script> without src is not allowed in layout XML — "
            "move the script body to a .phtml template and reference it with a <block>."
        )
    if _NOSCRIPT_BLOCK_RE.search(content or ""):
        errors.append(
            f"{label}: <noscript> is not allowed in head layout XML — "
            "move it into a .phtml template block."
        )
    return errors


def _theme_root(path: str) -> str | None:
    parts = path.replace("\\", "/").split("/")
    if len(parts) >= 5 and parts[0] == "app" and parts[1] == "design":
        return "/".join(parts[:5])
    return None


def _module_name_from_layout(layout_path: str) -> str:
    match = _MODULE_FROM_LAYOUT_RE.search(layout_path.replace("\\", "/"))
    return match.group(1) if match else "Magento_Theme"


def _templates_dir_for_layout(layout_path: str) -> str:
    parts = layout_path.replace("\\", "/").split("/")
    module = _module_name_from_layout(layout_path)
    theme_root = _theme_root(layout_path) or "/".join(parts[:5])
    return f"{theme_root}/{module}/templates"


def _infer_template_name(layout_path: str, script_blocks: list[str]) -> str:
    for block in script_blocks:
        comment = _TRACKING_NAME_RE.search(block)
        if comment:
            slug = re.sub(r"[^a-z0-9]+", "_", comment.group(1).lower()).strip("_")
            if slug:
                return f"{slug[:48]}.phtml"
    base = os.path.splitext(os.path.basename(layout_path))[0]
    if base == "default_head_blocks":
        return "meta_pixel.phtml"
    return f"{base}_scripts.phtml"


def _block_name_from_template(template_name: str) -> str:
    stem = os.path.splitext(template_name)[0]
    return re.sub(r"[^a-z0-9]+", ".", stem.lower()).strip(".") or "head.script"


def _template_reference(layout_path: str, template_name: str) -> str:
    module = _module_name_from_layout(layout_path)
    return f"{module}::{template_name}"


def _make_block_xml(layout_path: str, template_name: str) -> str:
    block_name = _block_name_from_template(template_name)
    template = _template_reference(layout_path, template_name)
    return (
        f'        <block class="Magento\\Framework\\View\\Element\\Template" '
        f'name="{block_name}" template="{template}"/>'
    )


def _insert_head_block(layout_content: str, block_xml: str) -> str:
    if block_xml.strip() in layout_content:
        return layout_content
    container_patterns = (
        r'(<referenceContainer\s+name="head\.additional"[^>]*>)',
        r'(<referenceBlock\s+name="head\.additional"[^>]*>)',
        r"(<head>)",
    )
    for pattern in container_patterns:
        match = re.search(pattern, layout_content, re.IGNORECASE)
        if match:
            insert_at = match.end()
            return (
                layout_content[:insert_at]
                + "\n"
                + block_xml
                + "\n"
                + layout_content[insert_at:]
            )
    if "</body>" in layout_content:
        wrapper = (
            '    <referenceContainer name="head.additional">\n'
            f"{block_xml}\n"
            "    </referenceContainer>\n"
        )
        return layout_content.replace("</body>", wrapper + "</body>", 1)
    return layout_content.rstrip() + (
        "\n    <referenceContainer name=\"head.additional\">\n"
        f"{block_xml}\n"
        "    </referenceContainer>\n"
    )


def _build_phtml_content(script_blocks: list[str], noscript_blocks: list[str]) -> str:
    parts: list[str] = []
    for block in script_blocks + noscript_blocks:
        stripped = block.strip()
        if stripped:
            parts.append(stripped)
    body = "\n\n".join(parts)
    return "<?php\n/** @var \\Magento\\Framework\\View\\Element\\Template $block */\n?>\n" + body + "\n"


def find_reference_tracking_templates(cwd: str, layout_targets: list[str]) -> list[str]:
    """Find existing tracking templates in the same theme (e.g. gtm_head.phtml) as a pattern."""
    refs: list[str] = []
    seen: set[str] = set()
    theme_roots = {_theme_root(path) for path in layout_targets if _theme_root(path)}
    preferred_names = (
        "gtm_head.phtml",
        "gtm_body.phtml",
        "google_tag.phtml",
        "head_scripts.phtml",
        "tracking_head.phtml",
    )
    for theme_root in sorted(theme_roots):
        if not theme_root:
            continue
        theme_abs = os.path.join(cwd, theme_root)
        if not os.path.isdir(theme_abs):
            continue
        for dirpath, _dirs, files in os.walk(theme_abs):
            if "/templates/" not in dirpath.replace("\\", "/"):
                continue
            for fname in files:
                if not fname.endswith(".phtml"):
                    continue
                lower = fname.lower()
                if lower not in preferred_names and "gtm" not in lower and "pixel" not in lower:
                    continue
                rel = os.path.relpath(os.path.join(dirpath, fname), cwd).replace("\\", "/")
                if rel not in seen:
                    seen.add(rel)
                    refs.append(rel)
    return refs[:4]


def related_theme_layout_paths(cwd: str, layout_targets: list[str]) -> list[str]:
    related: list[str] = []
    seen: set[str] = set()
    for rel in layout_targets:
        if not is_layout_xml_path(rel):
            continue
        layout_dir = os.path.dirname(os.path.join(cwd, rel))
        if not os.path.isdir(layout_dir):
            continue
        for fname in os.listdir(layout_dir):
            if not fname.endswith(".xml"):
                continue
            candidate = os.path.relpath(os.path.join(layout_dir, fname), cwd).replace("\\", "/")
            if candidate not in seen:
                seen.add(candidate)
                related.append(candidate)
    return related


def layout_files_referencing_template(
    cwd: str,
    template_basename: str,
    layout_targets: list[str],
) -> list[str]:
    refs: list[str] = []
    seen: set[str] = set()
    dirs = {
        os.path.dirname(os.path.join(cwd, rel))
        for rel in layout_targets
        if is_layout_xml_path(rel)
    }
    for layout_dir in dirs:
        if not os.path.isdir(layout_dir):
            continue
        for fname in os.listdir(layout_dir):
            if not fname.endswith(".xml"):
                continue
            rel = os.path.relpath(os.path.join(layout_dir, fname), cwd).replace("\\", "/")
            content = _read_file(cwd, rel) or ""
            if template_basename in content and rel not in seen:
                seen.add(rel)
                refs.append(rel)
    return refs


def scan_project_layout_head_errors(
    cwd: str,
    *,
    active_theme: str | None = None,
    seed_paths: list[str] | None = None,
) -> list[dict[str, Any]]:
    """Scan theme layout XML under app/design for invalid inline script/noscript."""
    findings: list[dict[str, Any]] = []
    seen: set[str] = set()

    def consider(rel: str) -> None:
        normalized = rel.replace("\\", "/")
        if normalized in seen or not is_layout_xml_path(normalized):
            return
        if active_theme and not _theme_matches_active(normalized, active_theme):
            return
        content = _read_file(cwd, normalized)
        if not content or not layout_has_invalid_head_tags(content):
            return
        seen.add(normalized)
        findings.append({
            "path": normalized,
            "errors": magento_head_layout_errors(content, normalized),
        })

    for rel in seed_paths or []:
        consider(rel)

    design_root = os.path.join(cwd, "app", "design", "frontend")
    if os.path.isdir(design_root):
        for dirpath, _dirs, files in os.walk(design_root):
            dir_norm = dirpath.replace("\\", "/")
            if "/layout/" not in dir_norm and "/page_layout/" not in dir_norm:
                continue
            for fname in files:
                if fname.endswith(".xml"):
                    consider(os.path.relpath(os.path.join(dirpath, fname), cwd).replace("\\", "/"))

    findings.sort(
        key=lambda item: (
            0 if "default_head_blocks" in item["path"] else 1,
            0 if (seed_paths and item["path"] in seed_paths) else 1,
            item["path"],
        ),
    )
    return findings


def _theme_matches_active(rel_path: str, active_theme: str | None) -> bool:
    if not active_theme:
        return True
    normalized = rel_path.replace("\\", "/")
    theme = active_theme.replace("\\", "/").strip("/")
    if "/" in theme:
        vendor, name = theme.rsplit("/", 1)
        return f"/frontend/{vendor}/{name}/" in normalized
    return theme in normalized


def _resolve_proposal_layout_contents(
    cwd: str,
    detail: dict[str, Any] | None,
) -> list[tuple[str, str]]:
    """Resolved layout XML content from the run's pending agent proposal."""
    from services.git_service import resolve_new_content

    rows: list[tuple[str, str]] = []
    for change in (detail or {}).get("output", {}).get("files") or []:
        path = (change.get("path") or "").replace("\\", "/")
        if not path or not is_layout_xml_path(path):
            continue
        resolved = resolve_new_content(cwd, change)
        content = resolved.get("content") or ""
        if content.strip():
            rows.append((path, content))
    return rows


def _layout_content_sources(
    cwd: str,
    analysis: dict[str, Any],
    detail: dict[str, Any] | None,
) -> list[tuple[str, str]]:
    """Disk layout files + pending proposal content to inspect for invalid head tags."""
    sources: list[tuple[str, str]] = []
    seen: set[str] = set()

    for path, content in _resolve_proposal_layout_contents(cwd, detail):
        if path not in seen:
            seen.add(path)
            sources.append((path, content))

    for rel in analysis.get("fixTargets") or []:
        if not is_layout_xml_path(rel) or rel in seen:
            continue
        content = _read_file(cwd, rel) or ""
        if content.strip():
            seen.add(rel)
            sources.append((rel, content))

    for finding in analysis.get("layoutScanFindings") or []:
        rel = finding.get("path")
        if not rel or rel in seen or not is_layout_xml_path(rel):
            continue
        content = _read_file(cwd, rel) or ""
        if content.strip():
            seen.add(rel)
            sources.append((rel, content))

    return sources


def _propose_layout_head_move(
    layout_path: str,
    content: str,
    cwd: str,
) -> list[dict[str, Any]] | None:
    script_blocks = _INLINE_SCRIPT_BLOCK_RE.findall(content)
    noscript_blocks = _NOSCRIPT_BLOCK_RE.findall(content)
    if not script_blocks and not noscript_blocks:
        return None

    template_name = _infer_template_name(layout_path, script_blocks)
    templates_dir = _templates_dir_for_layout(layout_path)
    phtml_path = f"{templates_dir}/{template_name}"

    if _read_file(cwd, phtml_path):
        stem, ext = os.path.splitext(template_name)
        template_name = f"{stem}_fixed{ext}"
        phtml_path = f"{templates_dir}/{template_name}"

    phtml_content = _build_phtml_content(script_blocks, noscript_blocks)
    new_layout = content
    for block in script_blocks + noscript_blocks:
        new_layout = new_layout.replace(block, "", 1)
    new_layout = re.sub(r"\n{3,}", "\n\n", new_layout)
    block_xml = _make_block_xml(layout_path, template_name)
    new_layout = _insert_head_block(new_layout, block_xml)

    if magento_head_layout_errors(new_layout, layout_path):
        return None
    if validate_layout_xml_content(new_layout, layout_path):
        return None

    return [
        {
            "path": phtml_path,
            "action": "create",
            "reason": "Move inline head script/noscript out of layout XML into a template block",
            "content": phtml_content,
        },
        {
            "path": layout_path,
            "action": "modify",
            "reason": "Remove invalid inline script/noscript and reference the new phtml block",
            "content": new_layout,
        },
    ]


def build_layout_dom_cleanup_fix(
    cwd: str,
    analysis: dict[str, Any],
) -> dict[str, Any] | None:
    """
    When layout XML on disk is valid but duplicate head blocks cause storefront DOM errors,
    remove duplicate meta/GTM block declarations from default.xml.
    """
    if not any(issue.get("kind") == "layout_dom_validation" for issue in (analysis.get("issues") or [])):
        return None

    targets = analysis.get("fixTargets") or []
    theme_roots = {_theme_root(p) for p in targets if _theme_root(p)}
    if not theme_roots:
        return None

    proposed_files: list[dict[str, Any]] = []
    summaries: list[str] = []

    for theme_root in sorted(theme_roots):
        head_blocks = f"{theme_root}/Magento_Theme/layout/default_head_blocks.xml"
        default_xml = f"{theme_root}/Magento_Theme/layout/default.xml"
        head_content = _read_file(cwd, head_blocks) or ""
        default_content = _read_file(cwd, default_xml) or ""
        if not head_content or not default_content:
            continue

        head_has_pixel = "meta.pixel" in head_content or "meta_pixel" in head_content
        if not head_has_pixel:
            continue

        duplicate_block = re.compile(
            r"\s*<referenceContainer\s+name=\"head\.additional\"[^>]*>\s*"
            r"<block[^>]*name=\"meta\.pixel\"[^>]*/>\s*"
            r"</referenceContainer>\s*",
            re.IGNORECASE,
        )
        if "meta.pixel" not in default_content:
            continue
        cleaned_default, count = duplicate_block.subn("\n", default_content, count=1)
        if count == 0:
            # Fallback: remove standalone duplicate meta.pixel block line in default.xml body
            line_re = re.compile(
                r"\s*<block[^>]*name=\"meta\.pixel\"[^>]*/>\s*\n?",
                re.IGNORECASE,
            )
            cleaned_default, count = line_re.subn("", default_content, count=1)
        if count == 0 or cleaned_default == default_content:
            continue
        if validate_layout_xml_content(cleaned_default, default_xml):
            continue

        proposed_files.append({
            "path": default_xml,
            "action": "modify",
            "reason": "Remove duplicate meta.pixel block — already declared in default_head_blocks.xml",
            "content": cleaned_default,
        })
        summaries.append(f"Removed duplicate meta.pixel from {default_xml}")

    if not proposed_files:
        return None

    return {
        "summary": "; ".join(summaries),
        "files": proposed_files,
        "manualTestChecklist": ["Re-run deploy and confirm the homepage loads without layout XML errors"],
        "risks": [],
    }


def build_layout_head_dom_auto_fix(
    cwd: str,
    analysis: dict[str, Any],
    detail: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    """
    Move inline <script>/<noscript> from layout XML into a phtml template block.
    Same pattern Cursor uses for Meta Pixel / GTM fixes.
    """
    if not any(issue.get("kind") == "layout_dom_validation" for issue in (analysis.get("issues") or [])):
        return None

    proposed_files: list[dict[str, Any]] = []
    summaries: list[str] = []
    handled_layouts: set[str] = set()

    for layout_path, content in _layout_content_sources(cwd, analysis, detail):
        if layout_path in handled_layouts:
            continue
        files = _propose_layout_head_move(layout_path, content, cwd)
        if not files:
            continue
        handled_layouts.add(layout_path)
        proposed_files.extend(files)
        summaries.append(
            f"Moved inline head tags from {layout_path} to "
            f"{next(f['path'] for f in files if f['action'] == 'create')} (Magento layout schema fix)"
        )

    if proposed_files:
        cleanup = build_layout_dom_cleanup_fix(cwd, analysis)
        if cleanup:
            existing = {f["path"] for f in proposed_files}
            for change in cleanup.get("files") or []:
                if change.get("path") not in existing:
                    proposed_files.append(change)
                    summaries.append(cleanup.get("summary") or "")
        return {
            "summary": "; ".join(s for s in summaries if s),
            "files": proposed_files,
            "manualTestChecklist": ["Re-run deploy and confirm the homepage loads without layout XML errors"],
            "risks": [],
        }

    return build_layout_dom_cleanup_fix(cwd, analysis)


def gather_layout_dom_reference_excerpts(
    cwd: str,
    fix_targets: list[str],
) -> list[dict[str, str]]:
    excerpts: list[dict[str, str]] = []
    seen: set[str] = set()

    def add(rel: str, limit: int = 12_000) -> None:
        if not rel or rel in seen:
            return
        content = _read_file(cwd, rel)
        if not content:
            return
        seen.add(rel)
        excerpts.append({"path": rel, "content": content[:limit]})

    for rel in fix_targets:
        add(rel, 16_000 if is_layout_xml_path(rel) else 12_000)

    for rel in related_theme_layout_paths(cwd, fix_targets):
        add(rel, 10_000)

    for rel in find_reference_tracking_templates(cwd, fix_targets):
        add(rel, 8000)
        basename = os.path.basename(rel)
        for wiring in layout_files_referencing_template(cwd, basename, fix_targets):
            add(wiring, 6000)

    return excerpts


def _read_file(cwd: str, rel_path: str) -> str | None:
    full = os.path.join(cwd, rel_path)
    if not os.path.isfile(full):
        return None
    with open(full, encoding="utf-8", errors="replace") as handle:
        return handle.read()
