"""Analyze Magento deploy failures and gather context for AI-assisted fixes."""

from __future__ import annotations

import os
import re
import xml.etree.ElementTree as ET
from typing import Any

from services.prompt_budget import (
    MAX_DEPLOY_OUTPUT_CHARS,
    trim_excerpts,
    trim_text,
)
from services.repo_context import (
    _merge_excerpts,
    _read_excerpt,
)
from services.layout_xml_validator import is_layout_xml_path
from services.layout_head_fix_service import (
    find_reference_tracking_templates,
    gather_layout_dom_reference_excerpts,
    layout_has_invalid_head_tags,
    magento_head_layout_errors,
    related_theme_layout_paths,
    scan_project_layout_head_errors,
)
from services.magento_error_parser import (
    THEME_LAYOUT_FILE_RE,
    is_layout_head_dom_validation_error,
    parse_storefront_error_text,
)

INVALID_XML_PATH_RE = re.compile(
    r'The XML in file "(?P<path>[^"]+)" is invalid',
    re.IGNORECASE,
)
DB_SCHEMA_PATH_RE = re.compile(
    r'The XML in file "(?P<path>[^"]+db_schema\.xml)" is invalid',
    re.IGNORECASE,
)
INVALID_ATTR_RE = re.compile(
    r"Element '(?P<element>\w+)', attribute '(?P<attr>\w+)': "
    r"The attribute '\w+' is not allowed\.\s*Line:\s*(?P<line>\d+)",
    re.IGNORECASE,
)
XML_ELEMENT_ERROR_RE = re.compile(
    r"Element '(?P<element>[^']+)':\s*(?P<detail>[^\n]+?)\.\s*Line:\s*(?P<line>\d+)",
    re.IGNORECASE,
)
MODULE_DISABLED_RE = re.compile(
    r"Module '([^']+)' is not installed",
    re.IGNORECASE,
)
COMPOSER_ERROR_RE = re.compile(
    r"(composer install failed|Could not find package|Your requirements could not be resolved|"
    r"composer\.json|composer\.lock)",
    re.IGNORECASE,
)
CONSTRAINT_COLUMNS_SELF_CLOSING_RE = re.compile(
    r"<constraint\b(?P<attrs>[^>]*)\bcolumns=\"(?P<columns>[^\"]+)\"(?P<rest>[^>]*)/>",
    re.IGNORECASE,
)
TABLE_BLOCK_RE = re.compile(
    r"(<table\b[^>]*>)(.*?)(</table>)",
    re.IGNORECASE | re.DOTALL,
)
COLUMN_PRIMARY_ATTR_RE = re.compile(r'\s+primary="(?:true|false)"', re.IGNORECASE)
COLUMN_NAME_ATTR_RE = re.compile(r'\bname="([^"]+)"', re.IGNORECASE)
PRIMARY_CONSTRAINT_RE = re.compile(
    r"<constraint\b[^>]*\bxsi:type=\"primary\"",
    re.IGNORECASE,
)
ERROR_FILE_IN_QUOTES_RE = re.compile(r'(?:file|File)\s+"([^"]+)"', re.IGNORECASE)
ERROR_ABS_PATH_RE = re.compile(
    r"(/var/www/html/[^\s:\"']+\.(?:php|phtml|xml|json|js|css|less|scss|html|ts|tsx))",
    re.IGNORECASE,
)
PHP_ERROR_IN_RE = re.compile(
    r"(?:Fatal error|Parse error|Uncaught \w+|syntax error)[^\n]* in (/var/www/html/\S+\.php) on line (\d+)",
    re.IGNORECASE,
)
MAGENTO_FILE_ERROR_RE = re.compile(
    r"There is an error in\s+(/var/www/html/\S+\.php)",
    re.IGNORECASE,
)
MAGENTO_PHP_LINE_RE = re.compile(
    r"(?:in |on )line\s+(\d+)",
    re.IGNORECASE,
)
WEBAPI_CONFIG_ROOT_ERROR_RE = re.compile(
    r"Webapi/etc/webapi\.xsd\}config",
    re.IGNORECASE,
)
WEBAPI_INVALID_ROOT_RE = re.compile(
    r"Webapi/etc/webapi\.xsd\}(?:config|routes)",
    re.IGNORECASE,
)
WEBAPI_NO_ROOT_DECL_RE = re.compile(
    r"No matching global declaration available for the validation root",
    re.IGNORECASE,
)
WEBAPI_WRONG_SCHEMA_RE = re.compile(
    r"urn:magento:framework:Webapi/etc/webapi\.xsd",
    re.IGNORECASE,
)
WEBAPI_CORRECT_SCHEMA = "urn:magento:module:Magento_Webapi:etc/webapi.xsd"
WEBAPI_ROUTE_BLOCK_RE = re.compile(r"<route\b[\s\S]*?</route>", re.IGNORECASE)
XML_MISSING_CHILD_RE = re.compile(
    r"Element '(?P<element>\w+)': Missing child element\(s\)\. Expected is \(\s*(?P<child>\w+)\s*\)\.\s*"
    r"Line:\s*(?P<line>\d+)",
    re.IGNORECASE,
)
WEBAPI_DEFAULT_RESOURCES = (
    "\n        <resources>\n"
    "            <resource ref=\"anonymous\"/>\n"
    "        </resources>"
)

NON_SOURCE_ERROR_PREFIXES = (
    "generated/",
    "var/generation/",
    "var/generated/",
    "vendor/",
)


def is_non_source_error_path(path: str | None) -> bool:
    if not path:
        return False
    normalized = path.replace("\\", "/")
    return any(normalized.startswith(prefix) for prefix in NON_SOURCE_ERROR_PREFIXES)


def _changed_app_code_paths(detail: dict | None) -> list[str]:
    if not detail:
        return []
    paths: list[str] = []
    seen: set[str] = set()
    for entry in (detail.get("output") or {}).get("files") or []:
        rel = (entry.get("path") or "").replace("\\", "/")
        if not rel.startswith("app/code/") or rel in seen:
            continue
        seen.add(rel)
        paths.append(rel)
    return paths


def _changed_task_paths(detail: dict | None) -> list[str]:
    if not detail:
        return []
    paths: list[str] = []
    seen: set[str] = set()
    for entry in (detail.get("output") or {}).get("files") or []:
        rel = (entry.get("path") or "").replace("\\", "/")
        if not rel or rel in seen:
            continue
        seen.add(rel)
        paths.append(rel)
    return paths


def _basenames_from_profile_reason(reason: str) -> list[str]:
    match = re.search(r"\(([^)]+)\)", reason or "")
    if not match:
        return []
    return [part.strip() for part in match.group(1).split(",") if part.strip()]


def _find_theme_file_by_basename(cwd: str, basename: str) -> str | None:
    if not basename or "/" in basename:
        return None
    for root_name in ("design", "code"):
        root = os.path.join(cwd, "app", root_name)
        if not os.path.isdir(root):
            continue
        for dirpath, _dirs, files in os.walk(root):
            if basename not in files:
                continue
            rel = os.path.relpath(os.path.join(dirpath, basename), cwd).replace("\\", "/")
            if rel.startswith("app/"):
                return rel
    return None


def _layout_and_template_paths(
    detail: dict | None,
    deploy: dict | None,
    cwd: str,
    raw_output: str,
) -> list[str]:
    paths: list[str] = []
    seen: set[str] = set()
    for rel in _changed_task_paths(detail):
        if is_layout_xml_path(rel) or rel.endswith(".phtml"):
            if rel not in seen:
                seen.add(rel)
                paths.append(rel)
    reason = (deploy or {}).get("profileReason") or ""
    for basename in _basenames_from_profile_reason(reason):
        found = _find_theme_file_by_basename(cwd, basename)
        if found and found not in seen:
            seen.add(found)
            paths.append(found)
    layout_match = THEME_LAYOUT_FILE_RE.search(raw_output or "")
    if layout_match:
        rel = layout_match.group(1).lstrip("/").replace("\\", "/")
        if rel not in seen:
            seen.add(rel)
            paths.append(rel)
    return paths


def _is_misleading_layout_stack_php(path: str) -> bool:
    normalized = path.replace("\\", "/")
    return normalized.endswith(".php") and normalized.startswith("app/code/")


def _filter_misleading_layout_error_files(
    error_files: list[str],
    issues: list[dict[str, Any]],
) -> list[str]:
    if not any(issue.get("kind") == "layout_dom_validation" for issue in issues):
        return error_files
    filtered: list[str] = []
    for path in error_files:
        if _is_misleading_layout_stack_php(path):
            continue
        filtered.append(path)
    return filtered


def _collect_storefront_layout_errors(
    output: str,
    cwd: str,
    issues: list[dict[str, Any]],
    summary_parts: list[str],
) -> bool:
    parsed = parse_storefront_error_text(output)
    if not is_layout_head_dom_validation_error(output, parsed):
        return False

    layout_file: str | None = None
    if parsed:
        candidate = parsed.get("file")
        if candidate and not str(candidate).endswith(".php"):
            layout_file = str(candidate).replace("\\", "/")
    if not layout_file:
        layout_match = THEME_LAYOUT_FILE_RE.search(output)
        if layout_match:
            layout_file = layout_match.group(1).lstrip("/").replace("\\", "/")

    details = (parsed or {}).get("details") or []
    detail_msg = (
        "; ".join(details[:3])
        if details
        else (parsed or {}).get("message") or "Invalid head/layout XML"
    )
    stack = (parsed or {}).get("stackFile")
    message = (
        f"Storefront layout/head XML validation failed: {detail_msg}. "
        "Fix the theme layout XML (for example default_head_blocks.xml) or linked phtml template — "
        "do NOT edit unrelated PHP plugins from the stack trace."
    )
    if stack:
        message += f" Stack trace references {stack} but the root cause is invalid layout XML."

    issues.append({
        "kind": "layout_dom_validation",
        "file": layout_file,
        "stackFile": stack,
        "message": message,
        "autoFixable": False,
    })
    summary_parts.append("Invalid theme layout/head XML (storefront check)")
    return True


def _find_likely_di_fix_targets(cwd: str, raw_output: str) -> list[str]:
    """Heuristic: locate app/code plugins related to a generated Interceptor failure."""
    match = re.search(
        r"generated/code/(.+?)/Interceptor\.php",
        raw_output.replace("\\", "/"),
        re.IGNORECASE,
    )
    if not match:
        return []

    fqcn = match.group(1).replace("/", "\\")
    short_name = fqcn.rsplit("\\", 1)[-1]
    app_code = os.path.join(cwd, "app", "code")
    if not os.path.isdir(app_code):
        return []

    targets: list[str] = []
    seen: set[str] = set()
    for dirpath, _dirs, files in os.walk(app_code):
        for fname in files:
            if not fname.endswith(".php"):
                continue
            full = os.path.join(dirpath, fname)
            rel = os.path.relpath(full, cwd).replace("\\", "/")
            if rel in seen:
                continue
            try:
                with open(full, encoding="utf-8", errors="replace") as fp:
                    content = fp.read()
            except OSError:
                continue
            if fqcn not in content and short_name not in content:
                continue
            if "parent::" in content or "Plugin" in fname or "Interceptor" in fname:
                seen.add(rel)
                targets.append(rel)
    return targets[:8]


def merge_deploy_analysis(deploy: dict | None, cwd: str) -> dict[str, Any]:
    """Re-analyze deploy output, falling back to stored analysis when needed."""
    fresh = analyze_deploy_failure(deploy, cwd)
    stored = (deploy or {}).get("analysis") or {}
    if not isinstance(stored, dict):
        stored = {}

    merged = {**stored, **fresh}
    if not fresh.get("rawOutput") and stored.get("rawOutput"):
        merged["rawOutput"] = stored["rawOutput"]
    if not fresh.get("issues") and stored.get("issues"):
        merged["issues"] = stored["issues"]
    if not fresh.get("errorFiles") and stored.get("errorFiles"):
        merged["errorFiles"] = stored["errorFiles"]
    if not fresh.get("summary") and stored.get("summary"):
        merged["summary"] = stored["summary"]
    if fresh.get("failedStep"):
        merged["failedStep"] = fresh["failedStep"]
    return merged


def _non_source_paths_from_analysis(analysis: dict[str, Any], cwd: str) -> list[str]:
    paths: list[str] = []
    seen: set[str] = set()
    for path in analysis.get("errorFiles") or []:
        rel = _rel_path(cwd, path) if path.startswith("/") else path.replace("\\", "/")
        if rel and is_non_source_error_path(rel) and rel not in seen:
            seen.add(rel)
            paths.append(rel)
    for rel in _paths_from_deploy_output(analysis.get("rawOutput") or "", cwd):
        if is_non_source_error_path(rel) and rel not in seen:
            seen.add(rel)
            paths.append(rel)
    for issue in analysis.get("issues") or []:
        for key in ("file", "reportedPath"):
            raw = issue.get(key)
            if not raw:
                continue
            rel = _rel_path(cwd, raw) if str(raw).startswith("/") else str(raw).replace("\\", "/")
            if rel and is_non_source_error_path(rel) and rel not in seen:
                seen.add(rel)
                paths.append(rel)
    return paths


def _theme_prefixes_from_paths(paths: list[str]) -> set[str]:
    prefixes: set[str] = set()
    for path in paths:
        theme_root = _theme_root_from_path(path)
        if theme_root:
            prefixes.add(theme_root)
    return prefixes


def _theme_root_from_path(path: str) -> str | None:
    parts = path.replace("\\", "/").split("/")
    if len(parts) >= 5 and parts[0] == "app" and parts[1] == "design":
        return "/".join(parts[:5])
    return None


def _path_allowed_for_layout_dom_fix(path: str, acceptable: set[str]) -> bool:
    if path in acceptable:
        return True
    prefixes = _theme_prefixes_from_paths(list(acceptable))
    normalized = path.replace("\\", "/")
    if not prefixes:
        return False
    if not any(normalized.startswith(prefix + "/") for prefix in prefixes):
        return False
    return is_layout_xml_path(normalized) or normalized.endswith(".phtml")


def sanitize_deploy_fix_files(
    cwd: str,
    analysis: dict[str, Any],
    files: list[dict],
) -> list[dict]:
    """Drop generated/vendor proposals; keep app/code fixes the agent should apply."""
    from services.git_service import normalize_agent_path

    acceptable = {p.replace("\\", "/") for p in deploy_fix_target_paths(analysis) if p}
    layout_dom = bool(analysis.get("layoutDomError"))
    sanitized: list[dict] = []
    for change in files:
        raw_path = change.get("path") or ""
        path = normalize_agent_path(cwd, raw_path)
        if not path:
            continue
        if is_non_source_error_path(path):
            continue
        if acceptable and path not in acceptable:
            if not (layout_dom and _path_allowed_for_layout_dom_fix(path, acceptable)):
                continue
        sanitized.append({**change, "path": path})
    return sanitized


def enrich_deploy_fix_analysis(
    analysis: dict[str, Any],
    detail: dict | None,
    cwd: str,
    *,
    active_theme: str | None = None,
) -> dict[str, Any]:
    """
    When DI compile fails in generated/vendor output, steer fixes to app/code sources.
    Generated interceptors are symptoms — edit the plugin/DI/class that caused them.
    """
    enriched = {**analysis}
    error_files = list(enriched.get("errorFiles") or [])
    issues = list(enriched.get("issues") or [])

    if any(issue.get("kind") == "layout_dom_validation" for issue in issues):
        deploy = (detail or {}).get("deploy")
        layout_targets = _layout_and_template_paths(
            detail,
            deploy,
            cwd,
            enriched.get("rawOutput") or "",
        )
        scan_findings = scan_project_layout_head_errors(
            cwd,
            active_theme=active_theme,
            seed_paths=layout_targets,
        )
        enriched["layoutScanFindings"] = scan_findings
        for finding in scan_findings:
            path = finding.get("path")
            if path and path not in layout_targets:
                layout_targets.append(path)
        if layout_targets:
            enriched["fixTargets"] = layout_targets
            filtered_errors = _filter_misleading_layout_error_files(error_files, issues)
            for path in layout_targets:
                if path not in filtered_errors:
                    filtered_errors.append(path)
            for rel in related_theme_layout_paths(cwd, layout_targets):
                if rel not in filtered_errors:
                    filtered_errors.append(rel)
            enriched["errorFiles"] = filtered_errors
            enriched["layoutDomError"] = True
            enriched["aiFixable"] = True
            refs = find_reference_tracking_templates(cwd, layout_targets)
            if refs:
                enriched["layoutReferenceTemplates"] = refs
            for rel in layout_targets:
                if not is_layout_xml_path(rel):
                    continue
                content = _read_file(cwd, rel) or ""
                if layout_has_invalid_head_tags(content):
                    for err in magento_head_layout_errors(content, rel):
                        if not any(i.get("message") == err for i in issues):
                            issues.append({
                                "kind": "layout_dom_validation",
                                "file": rel,
                                "message": err,
                                "autoFixable": True,
                            })
        enriched["issues"] = issues
        return enriched

    non_source = _non_source_paths_from_analysis(enriched, cwd)
    for path in non_source:
        if path not in error_files:
            error_files.append(path)
    enriched["errorFiles"] = error_files

    if not non_source:
        return enriched

    changed = _changed_app_code_paths(detail)
    fix_targets = [path for path in changed if not is_non_source_error_path(path)]
    if not fix_targets or all("/Test/" in path for path in fix_targets):
        likely = _find_likely_di_fix_targets(cwd, enriched.get("rawOutput") or "")
        for path in likely:
            if path not in fix_targets:
                fix_targets.append(path)
    if not fix_targets:
        for rel in _paths_from_deploy_output(enriched.get("rawOutput") or "", cwd):
            if rel.startswith("app/code/") and rel not in fix_targets:
                fix_targets.append(rel)

    if not fix_targets:
        return enriched

    for path in fix_targets:
        if path not in error_files:
            error_files.append(path)

    enriched["errorFiles"] = error_files
    enriched["fixTargets"] = fix_targets
    enriched["generatedError"] = True
    enriched["aiFixable"] = True

    if not any(issue.get("kind") == "generated_di_source" for issue in issues):
        reported = non_source[0]
        issues.append({
            "kind": "generated_di_source",
            "file": fix_targets[0],
            "reportedPath": reported,
            "message": (
                f"DI compile failed in generated file ({reported}). "
                f"Fix the source in app/code — likely a plugin, preference, or constructor "
                f"signature issue in: {', '.join(fix_targets[:4])}"
            ),
            "autoFixable": False,
        })
    enriched["issues"] = issues
    return enriched


def deploy_fix_target_paths(analysis: dict[str, Any]) -> list[str]:
    """Paths the deploy-fix proposal is allowed to edit."""
    fix_targets = analysis.get("fixTargets") or []
    error_files = analysis.get("errorFiles") or []
    preferred = [
        path.replace("\\", "/")
        for path in fix_targets
        if path and not is_non_source_error_path(path)
    ]
    if preferred:
        return preferred
    return [
        path.replace("\\", "/")
        for path in error_files
        if path and not is_non_source_error_path(path)
    ]


def build_deploy_fix_default_instructions(
    analysis: dict[str, Any],
    deploy: dict | None = None,
) -> str:
    """Structured fix request derived from deploy analysis (sent to AI when user leaves textarea blank)."""
    lines: list[str] = []

    summary = (analysis.get("summary") or "").strip()
    if summary:
        lines.append(f"Fix this deploy failure: {summary}")

    failed_step = analysis.get("failedStep")
    if failed_step:
        lines.append(f"Failed step: {failed_step}")

    for issue in analysis.get("issues") or []:
        kind = issue.get("kind") or "issue"
        message = (issue.get("message") or "").strip()
        if message:
            lines.append(f"[{kind}] {message}")

    for finding in analysis.get("layoutScanFindings") or []:
        path = finding.get("path")
        for err in finding.get("errors") or []:
            lines.append(f"[scan] {path}: {err}")

    raw = (analysis.get("rawOutput") or "").strip()
    if raw:
        excerpt = raw if len(raw) <= 2500 else raw[:2500] + "\n…"
        lines.append("\nDeploy output excerpt:\n" + excerpt)

    fix_targets = analysis.get("fixTargets") or []
    if fix_targets:
        lines.append("\nProject scan + task files to fix:")
        for path in fix_targets[:10]:
            lines.append(f"- {path}")

    if analysis.get("layoutDomError"):
        lines.append(
            "\nRequired Magento-standard fix:\n"
            "1. Scan confirmed invalid inline <script> or <noscript> in theme layout XML.\n"
            "2. Move that markup into a .phtml template under the active theme templates/ folder.\n"
            "3. Remove inline tags from layout XML and add a "
            "<block class=\"Magento\\Framework\\View\\Element\\Template\" template=\"Module::file.phtml\"/> "
            "inside referenceContainer name=\"head.additional\".\n"
            "4. Do NOT edit PHP plugin files from the stack trace — preserve all existing DI/functionality."
        )
        refs = analysis.get("layoutReferenceTemplates") or []
        if refs:
            lines.append("Follow existing tracking template wiring from: " + ", ".join(refs))

    return "\n".join(line for line in lines if line).strip()


def _failed_step_output(deploy: dict | None) -> tuple[str, str | None]:
    if not deploy:
        return "", None
    steps = deploy.get("steps") or []
    for step in reversed(steps):
        if not step.get("ok") and not step.get("skipped"):
            return step.get("output") or "", step.get("key")
    return deploy.get("error") or "", None


def _rel_path(cwd: str, reported_path: str) -> str | None:
    normalized = reported_path.replace("\\", "/")
    cwd_norm = os.path.normpath(cwd).replace("\\", "/").rstrip("/")
    if normalized.startswith(cwd_norm + "/"):
        return normalized[len(cwd_norm) + 1 :]
    docker_root = "/var/www/html"
    if normalized.startswith(docker_root + "/"):
        docker_rel = normalized[len(docker_root) + 1 :]
        if os.path.exists(os.path.join(cwd, docker_rel)):
            return docker_rel
        if docker_rel.startswith(("generated/", "var/", "vendor/", "app/", "pub/")):
            return docker_rel
    marker = "/app/code/"
    idx = normalized.find(marker)
    if idx >= 0:
        return normalized[idx + 1 :]
    if normalized.startswith("app/"):
        return normalized
    basename = os.path.basename(normalized)
    if "." in basename:
        for root, _dirs, files in os.walk(os.path.join(cwd, "app", "code")):
            if basename not in files:
                continue
            candidate = os.path.relpath(os.path.join(root, basename), cwd).replace("\\", "/")
            if normalized.endswith(candidate):
                return candidate
        design_root = os.path.join(cwd, "app", "design")
        if os.path.isdir(design_root):
            for root, _dirs, files in os.walk(design_root):
                if basename not in files:
                    continue
                candidate = os.path.relpath(os.path.join(root, basename), cwd).replace("\\", "/")
                if normalized.endswith(candidate):
                    return candidate
    return None


def _read_file(cwd: str, rel_path: str) -> str | None:
    full = os.path.join(cwd, rel_path)
    if not os.path.isfile(full):
        return None
    with open(full, encoding="utf-8") as fp:
        return fp.read()


def _write_file(cwd: str, rel_path: str, content: str) -> None:
    full = os.path.join(cwd, rel_path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w", encoding="utf-8") as fp:
        fp.write(content)


def _issue_message(element: str, attr: str) -> str:
    if element == "column" and attr == "auto_increment":
        return (
            'db_schema.xml uses deprecated auto_increment attribute. '
            'Use identity="true" instead.'
        )
    if element == "constraint" and attr == "columns":
        return (
            "db_schema.xml constraint uses invalid columns attribute. "
            "Use nested <column name=\"...\"/> elements instead."
        )
    if element == "column" and attr == "primary":
        return (
            'db_schema.xml uses invalid primary attribute on <column>. '
            'Remove primary="..." from columns; define primary keys with '
            '<constraint xsi:type="primary" referenceId="PRIMARY"> and nested '
            '<column name="..."/> elements.'
        )
    return f"db_schema.xml has invalid {element} attribute: {attr}"


def _is_auto_fixable(element: str, attr: str, rel: str | None) -> bool:
    if not rel:
        return False
    return (
        (element == "column" and attr in ("auto_increment", "primary"))
        or (element == "constraint" and attr == "columns")
    )


def _primary_column_names(table_body: str) -> list[str]:
    names: list[str] = []
    for match in re.finditer(
        r"<column\b[^>]*\bprimary=\"true\"[^>]*(?:/>|>)",
        table_body,
        re.IGNORECASE,
    ):
        name_match = COLUMN_NAME_ATTR_RE.search(match.group(0))
        if name_match:
            names.append(name_match.group(1))
    return names


def _make_primary_constraint(column_names: list[str]) -> str:
    cols = "".join(f'\n            <column name="{name}"/>' for name in column_names)
    return f'\n        <constraint xsi:type="primary" referenceId="PRIMARY">{cols}\n        </constraint>'


def _fix_table_primary_columns(table_open: str, table_body: str, table_close: str) -> tuple[str, list[str]]:
    if 'primary="' not in table_body.lower():
        return table_open + table_body + table_close, []

    primary_cols = _primary_column_names(table_body)
    new_body = COLUMN_PRIMARY_ATTR_RE.sub("", table_body)
    summaries: list[str] = []

    if primary_cols:
        summaries.append(
            "Removed invalid primary attribute from column(s): " + ", ".join(primary_cols)
        )
    else:
        summaries.append("Removed invalid primary attribute from column(s)")

    if primary_cols and not PRIMARY_CONSTRAINT_RE.search(new_body):
        new_body = new_body.rstrip() + _make_primary_constraint(primary_cols) + "\n    "
        summaries.append(
            "Added primary key constraint for column(s): " + ", ".join(primary_cols)
        )

    return table_open + new_body + table_close, summaries


def _fix_db_schema_content(content: str) -> tuple[str, list[str]]:
    """Apply all known db_schema.xml fixes to file content."""
    summaries: list[str] = []
    updated = content

    if 'auto_increment="' in updated:
        next_content = updated.replace('auto_increment="true"', 'identity="true"')
        next_content = next_content.replace('auto_increment="false"', 'identity="false"')
        if next_content != updated:
            summaries.append("Replaced auto_increment with identity")
            updated = next_content

    def _replace_constraint(match: re.Match[str]) -> str:
        attrs = (match.group("attrs") + match.group("rest")).strip()
        columns = [c.strip() for c in match.group("columns").split(",") if c.strip()]
        column_xml = "".join(f'\n            <column name="{col}" />' for col in columns)
        return f"<constraint{attrs}>{column_xml}\n        </constraint>"

    next_content = CONSTRAINT_COLUMNS_SELF_CLOSING_RE.sub(_replace_constraint, updated)
    if next_content != updated:
        summaries.append("Converted constraint columns attribute to nested column elements")
        updated = next_content

    if 'primary="' in updated.lower():
        table_summaries: list[str] = []

        def _fix_table(match: re.Match[str]) -> str:
            fixed, parts = _fix_table_primary_columns(
                match.group(1),
                match.group(2),
                match.group(3),
            )
            table_summaries.extend(parts)
            return fixed

        next_content = TABLE_BLOCK_RE.sub(_fix_table, updated)
        if next_content != updated:
            summaries.extend(dict.fromkeys(table_summaries))
            updated = next_content

    return updated, summaries


def _webapi_routes_missing_resources(content: str) -> bool:
    if not re.search(r"<route\b", content, re.IGNORECASE):
        return False
    for block in WEBAPI_ROUTE_BLOCK_RE.findall(content):
        if re.search(r"<route\b", block, re.IGNORECASE) and not re.search(
            r"<resources\b", block, re.IGNORECASE
        ):
            return True
    return False


def _fix_webapi_route_block(block: str) -> str:
    if re.search(r"<resources\b", block, re.IGNORECASE):
        return block
    return re.sub(
        r"</route>\s*$",
        f"{WEBAPI_DEFAULT_RESOURCES}\n    </route>",
        block,
        count=1,
        flags=re.IGNORECASE,
    )


def _rebuild_webapi_shell(content: str) -> tuple[str, list[str]]:
    summaries: list[str] = []
    if re.search(r"<config\b", content):
        summaries.append("Replaced webapi.xml root <config> with <routes>")

    route_blocks = [ _fix_webapi_route_block(b) for b in WEBAPI_ROUTE_BLOCK_RE.findall(content) ]
    lines = [
        '<?xml version="1.0"?>',
        (
            f'<routes xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
            f'xsi:noNamespaceSchemaLocation="{WEBAPI_CORRECT_SCHEMA}">'
        ),
    ]
    for block in route_blocks:
        indented = "\n".join(
            f"    {line}" if line.strip() else line
            for line in block.splitlines()
        )
        lines.append(indented)
    lines.append("</routes>")
    lines.append("")
    summaries.append("Rebuilt webapi.xml with correct Magento_Webapi schema URI")
    return "\n".join(lines), summaries


def _fix_webapi_missing_resources(content: str) -> tuple[str, list[str]]:
    if not _webapi_routes_missing_resources(content):
        return content, []

    route_blocks = WEBAPI_ROUTE_BLOCK_RE.findall(content)
    fixed_blocks = [_fix_webapi_route_block(block) for block in route_blocks]
    if fixed_blocks == route_blocks:
        return content, []

    updated = content
    for original, fixed in zip(route_blocks, fixed_blocks):
        if original != fixed:
            updated = updated.replace(original, fixed, 1)

    if re.search(r"<routes\b", updated, re.IGNORECASE):
        shell, _ = _rebuild_webapi_shell(updated)
        updated = shell

    return updated, ["Added required <resources> to webapi.xml <route> element(s)"]


def _webapi_needs_rebuild(content: str) -> bool:
    if re.search(r"<config\b", content):
        return True
    if WEBAPI_WRONG_SCHEMA_RE.search(content):
        return True
    if re.search(r"<routes\b", content) and WEBAPI_CORRECT_SCHEMA not in content:
        return True
    if re.search(r'<routes\b[^>]*\sxmlns="urn:magento:', content, re.IGNORECASE):
        return True
    return False


def _fix_webapi_content(content: str) -> tuple[str, list[str]]:
    """Fix webapi.xml schema, structure, and required route children."""
    summaries: list[str] = []
    updated = content

    if _webapi_needs_rebuild(updated):
        updated, part = _rebuild_webapi_shell(updated)
        summaries.extend(part)

    if _webapi_routes_missing_resources(updated):
        updated, part = _fix_webapi_missing_resources(updated)
        summaries.extend(part)

    return updated, summaries


def _auto_fix_file_content(rel: str, content: str, issue_kinds: list[str]) -> tuple[str, list[str]]:
    updated = content
    summaries: list[str] = []
    if rel.endswith("db_schema.xml") or any(k.startswith("db_schema_") for k in issue_kinds):
        updated, part = _fix_db_schema_content(updated)
        summaries.extend(part)
    if rel.endswith("webapi.xml") or any(k.startswith("webapi_") for k in issue_kinds):
        updated, part = _fix_webapi_content(updated)
        summaries.extend(part)
    return updated, summaries


def _find_webapi_with_missing_resources(cwd: str) -> str | None:
    code_root = os.path.join(cwd, "app", "code")
    if not os.path.isdir(code_root):
        return None
    for root, _dirs, files in os.walk(code_root):
        if "webapi.xml" not in files:
            continue
        rel = os.path.relpath(os.path.join(root, "webapi.xml"), cwd).replace("\\", "/")
        content = _read_file(cwd, rel) or ""
        if _webapi_routes_missing_resources(content):
            return rel
    return None


def _is_webapi_route_resources_error(element: str, detail: str) -> bool:
    return (
        element.lower() == "route"
        and "missing child" in detail.lower()
        and "resources" in detail.lower()
    )


def _xml_parse_error(content: str) -> str | None:
    try:
        ET.fromstring(content)
    except ET.ParseError as exc:
        return str(exc)
    return None


def _collect_db_schema_wellformedness(
    cwd: str,
    rel: str | None,
    issues: list[dict[str, Any]],
    summary_parts: list[str],
) -> bool:
    """Return True when a well-formedness issue was recorded."""
    if not rel or not rel.endswith("db_schema.xml"):
        return False
    content = _read_file(cwd, rel)
    if content is None:
        return False
    parse_error = _xml_parse_error(content)
    if not parse_error:
        return False
    message = (
        f"db_schema.xml ({rel}) is not well-formed XML: {parse_error}. "
        "Repair duplicate/broken tags and ensure every <table> is closed."
    )
    issues.append({
        "kind": "db_schema_malformed",
        "file": rel,
        "message": message,
        "autoFixable": False,
    })
    summary_parts.append(f"Malformed db_schema.xml ({rel})")
    return True


def _collect_standalone_xml_errors(
    output: str,
    cwd: str,
    issues: list[dict[str, Any]],
    summary_parts: list[str],
) -> None:
    """Parse Magento XML errors that appear without a preceding file path line."""
    if INVALID_XML_PATH_RE.search(output):
        return

    missing_child = list(XML_MISSING_CHILD_RE.finditer(output))
    if not missing_child:
        return

    rel: str | None = None
    for path_match in ERROR_FILE_IN_QUOTES_RE.finditer(output):
        candidate = _rel_path(cwd, path_match.group(1))
        if candidate and candidate.endswith("webapi.xml"):
            rel = candidate
            break

    route_lines: list[int] = []
    for match in missing_child:
        element = match.group("element")
        child = match.group("child")
        if element.lower() == "route" and child.lower() == "resources":
            route_lines.append(int(match.group("line")))

    if not route_lines:
        return

    if not rel:
        rel = _find_webapi_with_missing_resources(cwd)

    message = (
        f"webapi.xml ({rel}) route(s) missing required <resources> child "
        f"(lines {', '.join(str(n) for n in route_lines)})"
        if rel
        else f"webapi.xml route(s) missing required <resources> (lines {', '.join(str(n) for n in route_lines)})"
    )
    issues.append({
        "kind": "webapi_route_missing_resources",
        "file": rel,
        "lines": route_lines,
        "message": message,
        "autoFixable": bool(rel),
    })
    summary_parts.append(message)


def _xml_file_label(rel: str | None, reported: str) -> str:
    if rel:
        return os.path.basename(rel)
    return os.path.basename(reported.replace("\\", "/"))


def _collect_xml_issues(
    output: str,
    cwd: str,
    issues: list[dict[str, Any]],
    summary_parts: list[str],
) -> None:
    for path_match in INVALID_XML_PATH_RE.finditer(output):
        reported = path_match.group("path")
        rel = _rel_path(cwd, reported)
        label = _xml_file_label(rel, reported)
        is_db_schema = label == "db_schema.xml"

        invalid_attrs = list(INVALID_ATTR_RE.finditer(output))
        if is_db_schema and invalid_attrs:
            grouped: dict[tuple[str, str], list[int]] = {}
            for match in invalid_attrs:
                key = (match.group("element"), match.group("attr"))
                grouped.setdefault(key, []).append(int(match.group("line")))

            for (element, attr), lines in grouped.items():
                auto_fixable = _is_auto_fixable(element, attr, rel)
                issues.append({
                    "kind": f"db_schema_{element}_{attr}",
                    "file": rel,
                    "reportedPath": reported,
                    "lines": lines,
                    "message": _issue_message(element, attr),
                    "autoFixable": auto_fixable,
                })
                summary_parts.append(
                    f"Invalid db_schema.xml ({rel or reported}): {element}.{attr}"
                )
            continue

        xml_errors = list(XML_ELEMENT_ERROR_RE.finditer(output))
        if xml_errors:
            for match in xml_errors:
                element = match.group("element")
                detail = match.group("detail").strip()
                line = int(match.group("line"))
                auto_fixable = (
                    label == "webapi.xml"
                    and (
                        bool(WEBAPI_INVALID_ROOT_RE.search(element))
                        or WEBAPI_NO_ROOT_DECL_RE.search(detail)
                        or _is_webapi_route_resources_error(element, detail)
                    )
                )
                if auto_fixable and _is_webapi_route_resources_error(element, detail):
                    kind = "webapi_route_missing_resources"
                elif auto_fixable:
                    kind = "webapi_invalid"
                else:
                    kind = "xml_validation"
                issues.append({
                    "kind": kind,
                    "file": rel,
                    "reportedPath": reported,
                    "lines": [line],
                    "element": element,
                    "message": f"Invalid {label} ({rel or reported}): {element} — {detail} (line {line})",
                    "autoFixable": auto_fixable,
                })
            summary_parts.append(f"Invalid {label}: {rel or reported}")
        else:
            if is_db_schema and rel and _collect_db_schema_wellformedness(cwd, rel, issues, summary_parts):
                continue
            issues.append({
                "kind": "xml_validation",
                "file": rel,
                "reportedPath": reported,
                "message": f"Invalid XML in {label} ({rel or reported}). See deploy output for details.",
                "autoFixable": False,
            })
            summary_parts.append(f"Invalid {label}: {rel or reported}")


def _error_files_from_analysis(output: str, cwd: str, issues: list[dict[str, Any]]) -> list[str]:
    files: list[str] = []
    seen: set[str] = set()
    for rel in _paths_from_deploy_output(output, cwd):
        if rel not in seen:
            seen.add(rel)
            files.append(rel)
    for issue in issues:
        rel = issue.get("file")
        if rel and rel not in seen:
            seen.add(rel)
            files.append(rel)
    return files


def _collect_magento_php_compile_errors(
    output: str,
    cwd: str,
    issues: list[dict[str, Any]],
    summary_parts: list[str],
) -> None:
    seen: set[str] = set()
    for match in MAGENTO_FILE_ERROR_RE.finditer(output):
        reported = match.group(1)
        rel = _rel_path(cwd, reported)
        key = rel or reported
        if key in seen:
            continue
        seen.add(key)

        after = output[match.end() : match.end() + 400]
        line_match = MAGENTO_PHP_LINE_RE.search(after)
        line_num = int(line_match.group(1)) if line_match else None
        if line_num is None:
            line_num = _php_error_line_from_output(output, reported, rel)

        detail_parts: list[str] = []
        for raw_line in after.splitlines()[:5]:
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            detail_parts.append(line)
            if line_match and line_match.group(0) in line:
                break
        detail_msg = " ".join(detail_parts)[:240] if detail_parts else "syntax error during DI compile"

        issues.append({
            "kind": "php_syntax",
            "file": rel,
            "reportedPath": reported,
            "lines": [line_num] if line_num else [],
            "message": f"PHP syntax error in {rel or reported}: {detail_msg}",
            "autoFixable": False,
        })
        summary_parts.append(f"PHP syntax error: {rel or os.path.basename(reported)}")


def analyze_deploy_failure(deploy: dict | None, cwd: str) -> dict[str, Any]:
    output, failed_step = _failed_step_output(deploy)
    issues: list[dict[str, Any]] = []
    summary_parts: list[str] = []

    if INVALID_XML_PATH_RE.search(output):
        _collect_xml_issues(output, cwd, issues, summary_parts)

    _collect_standalone_xml_errors(output, cwd, issues, summary_parts)

    _collect_storefront_layout_errors(output, cwd, issues, summary_parts)

    _collect_magento_php_compile_errors(output, cwd, issues, summary_parts)

    php_errors = list(PHP_ERROR_IN_RE.finditer(output))
    if php_errors:
        seen_php: set[str] = set()
        for match in php_errors:
            reported = match.group(1)
            rel = _rel_path(cwd, reported)
            key = rel or reported
            if key in seen_php:
                continue
            seen_php.add(key)
            line = int(match.group(2))
            issues.append({
                "kind": "php_runtime",
                "file": rel,
                "reportedPath": reported,
                "lines": [line],
                "message": f"PHP error in {rel or reported} (line {line})",
                "autoFixable": False,
            })
            summary_parts.append(f"PHP error: {rel or reported}")

    module_match = MODULE_DISABLED_RE.search(output)
    if module_match:
        module = module_match.group(1)
        issues.append({
            "kind": "module_not_enabled",
            "module": module,
            "message": f"Module {module} is not enabled. Run bin/magento module:enable {module}.",
            "autoFixable": False,
        })
        summary_parts.append(f"Module not enabled: {module}")

    if failed_step == "composer_install" and COMPOSER_ERROR_RE.search(output):
        issues.append({
            "kind": "composer_install",
            "message": "Composer install failed. Review dependency versions and composer.lock.",
            "autoFixable": False,
        })
        summary_parts.append("Composer install failed")

    if not issues and output.strip():
        issues.append({
            "kind": "unknown",
            "message": "Deployment failed with an unrecognized error.",
            "autoFixable": False,
            "rawExcerpt": output.strip()[-2000:],
        })
        summary_parts.append("Unrecognized deploy error")

    auto_fixable = any(i.get("autoFixable") for i in issues)
    primary_summary = summary_parts[0] if len(summary_parts) == 1 else (
        f"{len(issues)} issue(s) detected during deploy"
        if issues
        else (output.strip().split("\n")[-1][:200] if output.strip() else "Deploy failed")
    )
    error_files = _error_files_from_analysis(output, cwd, issues)
    error_files = _filter_misleading_layout_error_files(error_files, issues)
    return {
        "failedStep": failed_step,
        "summary": primary_summary,
        "issues": issues,
        "errorFiles": error_files,
        "autoFixable": auto_fixable,
        "aiFixable": bool(output.strip()),
        "rawOutput": trim_text(output, MAX_DEPLOY_OUTPUT_CHARS) if output else "",
    }


def apply_auto_fixes(cwd: str, analysis: dict[str, Any]) -> list[dict[str, str]]:
    targets = _auto_fix_targets(cwd, analysis)
    applied: list[dict[str, str]] = []
    for rel, kinds in sorted(targets.items()):
        content = _read_file(cwd, rel)
        if content is None:
            continue
        updated, summaries = _auto_fix_file_content(rel, content, kinds)
        if updated == content:
            continue
        _write_file(cwd, rel, updated)
        applied.append({
            "path": rel,
            "summary": "; ".join(summaries) or f"Fixed {rel}",
        })
    return applied


def _auto_fix_targets(cwd: str, analysis: dict[str, Any]) -> dict[str, list[str]]:
    """Map repository-relative paths to auto-fixable issue kinds."""
    targets: dict[str, list[str]] = {}
    output = analysis.get("rawOutput") or ""

    for issue in analysis.get("issues") or []:
        if not issue.get("autoFixable"):
            continue
        rel = issue.get("file")
        if not rel:
            continue
        targets.setdefault(rel, []).append(issue.get("kind", ""))

    for rel in analysis.get("errorFiles") or []:
        if not rel.endswith("webapi.xml"):
            continue
        kinds = targets.setdefault(rel, [])
        if WEBAPI_INVALID_ROOT_RE.search(output) or WEBAPI_NO_ROOT_DECL_RE.search(output):
            if "webapi_invalid" not in kinds:
                kinds.append("webapi_invalid")
        elif _webapi_needs_rebuild(content := (_read_file(cwd, rel) or "")):
            if "webapi_invalid" not in kinds:
                kinds.append("webapi_invalid")
        elif _webapi_routes_missing_resources(content := (_read_file(cwd, rel) or "")):
            if "webapi_route_missing_resources" not in kinds:
                kinds.append("webapi_route_missing_resources")

    if not targets:
        orphan = _find_webapi_with_missing_resources(cwd)
        if orphan and any(i.get("kind") == "webapi_route_missing_resources" for i in analysis.get("issues") or []):
            targets.setdefault(orphan, []).append("webapi_route_missing_resources")

    return targets


def _php_error_line_from_output(output: str, reported: str, rel: str | None) -> int | None:
    names = {n for n in (os.path.basename(reported), os.path.basename(rel or ""), rel or "") if n}
    for name in names:
        for pattern in (
            rf"{re.escape(name)}[^\n]{{0,160}}on line (\d+)",
            rf"{re.escape(name)}[^\n]{{0,160}}in line (\d+)",
        ):
            match = re.search(pattern, output, re.IGNORECASE)
            if match:
                return int(match.group(1))
    for pattern in (r"on line (\d+)", r"in line (\d+)"):
        match = re.search(pattern, output, re.IGNORECASE)
        if match:
            return int(match.group(1))
    return None


def _make_php_linter(
    cwd: str,
    php_bin: str | None,
    docker_compose_path: str | None,
):
    from services.php_lint import lint_php_content_for_project

    def lint(content: str) -> str | None:
        return lint_php_content_for_project(
            cwd,
            content,
            php_bin=php_bin,
            docker_compose_path=docker_compose_path,
        )

    return lint


def _fix_unmatched_brace(content: str, lint_fn, error_line: int | None) -> str | None:
    """Try minimal brace edits until php -l passes."""
    if lint_fn(content) is None:
        return content

    lines = content.splitlines(keepends=True)
    if lines:
        candidates: list[int] = []
        if error_line and 1 <= error_line <= len(lines):
            candidates.extend(range(error_line - 1, max(-1, error_line - 12), -1))
        candidates.extend(range(len(lines) - 1, -1, -1))
        seen_idx: set[int] = set()
        for idx in candidates:
            if idx in seen_idx or idx < 0 or idx >= len(lines):
                continue
            seen_idx.add(idx)
            line = lines[idx]
            for pos in reversed([i for i, ch in enumerate(line) if ch == "}"]):
                new_line = line[:pos] + line[pos + 1 :]
                candidate = "".join(lines[:idx] + [new_line] + lines[idx + 1 :])
                if lint_fn(candidate) is None:
                    return candidate

        trimmed = content.rstrip()
        for _ in range(8):
            if not trimmed.endswith("}"):
                break
            trimmed = trimmed[:-1].rstrip()
            candidate = trimmed + "\n"
            if lint_fn(candidate) is None:
                return candidate

    for pos in reversed([i for i, ch in enumerate(content) if ch == "}"]):
        candidate = content[:pos] + content[pos + 1 :]
        if lint_fn(candidate) is None:
            return candidate

    stripped = content.rstrip()
    for suffix in ("}\n", "\n}\n", "\n    }\n}\n"):
        candidate = stripped + suffix
        if lint_fn(candidate) is None:
            return candidate

    return None


def build_php_syntax_auto_fix(
    cwd: str,
    analysis: dict[str, Any],
    php_bin: str = "php",
    docker_compose_path: str | None = None,
) -> dict[str, Any] | None:
    """Deterministic fix for PHP parse/syntax errors (e.g. unmatched braces) before calling AI."""
    lint_fn = _make_php_linter(cwd, php_bin, docker_compose_path)

    php_issues = [
        issue
        for issue in (analysis.get("issues") or [])
        if issue.get("kind") in ("php_syntax", "php_runtime") and issue.get("file")
    ]
    if not php_issues:
        return None

    files: list[dict[str, Any]] = []
    summaries: list[str] = []
    for issue in php_issues[:3]:
        rel = issue["file"]
        content = _read_file(cwd, rel)
        if content is None:
            continue
        if lint_fn(content) is None:
            continue

        line_nums = issue.get("lines") or []
        error_line = line_nums[0] if line_nums else None
        fixed = _fix_unmatched_brace(content, lint_fn, error_line)
        if not fixed or fixed == content:
            continue
        if lint_fn(fixed) is not None:
            continue

        files.append({
            "path": rel,
            "action": "modify",
            "reason": f"Auto-fix PHP syntax: {issue.get('message', 'syntax error')}",
            "content": fixed,
        })
        summaries.append(f"Auto-fixed PHP syntax in {rel}")

    if not files:
        return None
    return {
        "summary": "; ".join(summaries),
        "files": files,
        "manualTestChecklist": ["Re-run local deploy"],
        "risks": [],
    }


def build_auto_fix_proposals(cwd: str, analysis: dict[str, Any]) -> dict[str, Any] | None:
    """Build an agent-style fix proposal for known deploy errors (no disk write)."""
    targets = _auto_fix_targets(cwd, analysis)
    files: list[dict[str, Any]] = []
    summaries: list[str] = []

    for rel, kinds in sorted(targets.items()):
        content = _read_file(cwd, rel)
        if content is None:
            continue
        updated, file_summaries = _auto_fix_file_content(rel, content, kinds)
        if updated == content:
            continue
        files.append({
            "path": rel,
            "action": "modify",
            "reason": "; ".join(file_summaries) or f"Auto-fix deploy error in {rel}",
            "content": updated,
        })
        summaries.extend(file_summaries)

    if not files:
        return None
    return {
        "summary": "; ".join(dict.fromkeys(summaries)) or "Auto-fixed known deploy error(s)",
        "files": files,
        "manualTestChecklist": ["Re-run local deploy (setup:upgrade)"],
        "risks": [],
    }


def enrich_deploy_report(report: dict, cwd: str) -> dict:
    if report.get("ok"):
        return report
    analysis = analyze_deploy_failure(report, cwd)
    return {**report, "analysis": analysis}


def _paths_from_deploy_output(output: str, cwd: str) -> list[str]:
    rel_paths: list[str] = []
    seen: set[str] = set()
    for match in ERROR_FILE_IN_QUOTES_RE.finditer(output):
        rel = _rel_path(cwd, match.group(1))
        if rel and rel not in seen:
            seen.add(rel)
            rel_paths.append(rel)
    for match in ERROR_ABS_PATH_RE.finditer(output):
        rel = _rel_path(cwd, match.group(1))
        if rel and rel not in seen:
            seen.add(rel)
            rel_paths.append(rel)
    return rel_paths


def gather_deploy_fix_excerpts(
    cwd: str,
    deploy: dict | None,
    analysis: dict[str, Any],
) -> list[dict[str, str]]:
    """Focused file excerpts for deploy-fix — only files tied to the deploy error."""
    output, _failed_step = _failed_step_output(deploy)
    error_files = analysis.get("errorFiles") or _paths_from_deploy_output(output, cwd)
    fix_targets = analysis.get("fixTargets") or []
    syntax_files = {
        issue.get("file")
        for issue in (analysis.get("issues") or [])
        if issue.get("kind") in ("php_syntax", "php_runtime", "generated_di_source") and issue.get("file")
    }
    layout_files = {
        issue.get("file")
        for issue in (analysis.get("issues") or [])
        if issue.get("kind") == "layout_dom_validation" and issue.get("file")
    }
    path_excerpts = []
    if analysis.get("layoutDomError") and fix_targets:
        path_excerpts = gather_layout_dom_reference_excerpts(cwd, fix_targets)
    for rel in fix_targets[:6]:
        if rel in {item["path"] for item in path_excerpts}:
            continue
        item = _read_excerpt(cwd, rel, 8000)
        if item:
            path_excerpts.append(item)
    for rel in sorted(layout_files)[:4]:
        if rel in {item["path"] for item in path_excerpts}:
            continue
        content = _read_file(cwd, rel)
        if content:
            path_excerpts.append({"path": rel, "content": content[:12_000]})
    for rel in error_files[:6]:
        if analysis.get("generatedError") and is_non_source_error_path(rel):
            continue
        if rel in {item["path"] for item in path_excerpts}:
            continue
        if rel in syntax_files:
            content = _read_file(cwd, rel)
            if content:
                path_excerpts.append({"path": rel, "content": content[:12_000]})
                continue
        item = _read_excerpt(cwd, rel, 2500)
        if item:
            path_excerpts.append(item)

    issue_excerpts = file_excerpts_for_analysis(cwd, analysis)[:4]
    merged = _merge_excerpts(path_excerpts, issue_excerpts)
    return trim_excerpts(merged)


def file_excerpts_for_analysis(cwd: str, analysis: dict[str, Any]) -> list[dict[str, str]]:
    excerpts: list[dict[str, str]] = []
    seen: set[str] = set()
    for issue in analysis.get("issues") or []:
        rel = issue.get("file")
        if not rel or rel in seen:
            continue
        content = _read_file(cwd, rel)
        if content is None:
            continue
        seen.add(rel)
        excerpts.append({"path": rel, "content": content[:8000]})
    return excerpts
