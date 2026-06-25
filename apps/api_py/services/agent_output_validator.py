"""Reject AI agent output that contains stub/placeholder code instead of real implementations."""

from __future__ import annotations

import os
import re
from typing import Any

from services.git_service import resolve_new_content, _read_if_exists, _safe_join

STUB_COMMENT_RE = re.compile(
    r"//\s*(Logic to\b|TODO\b|FIXME\b|implement\b|placeholder\b|stub\b|add logic\b)",
    re.IGNORECASE,
)
EMPTY_PHP_METHOD_RE = re.compile(
    r"function\s+\w+\s*\([^)]*\)\s*(?::\s*[\w\\|]+\s*)?\{\s*\}",
    re.MULTILINE,
)
METHOD_ONLY_COMMENTS_RE = re.compile(
    r"function\s+\w+\s*\([^)]*\)\s*(?::\s*[\w\\|]+\s*)?\{[^{}]*//[^}]*\}",
    re.MULTILINE | re.DOTALL,
)
PHP_CODE_FILE_RE = re.compile(r"\.php$", re.IGNORECASE)


def _strip_php_comments_preserve_strings(content: str) -> str:
    out: list[str] = []
    i = 0
    n = len(content)
    while i < n:
        if content.startswith("//", i):
            i += 2
            while i < n and content[i] not in "\n\r":
                i += 1
            continue
        if content.startswith("/*", i):
            end = content.find("*/", i + 2)
            i = n if end == -1 else end + 2
            continue
        if content[i] in "\"'":
            quote = content[i]
            i += 1
            while i < n:
                if content[i] == "\\":
                    i += 2
                    continue
                if content[i] == quote:
                    i += 1
                    break
                i += 1
            continue
        out.append(content[i])
        i += 1
    return "".join(out)


def _meaningful_php_lines(content: str) -> list[str]:
    stripped = _strip_php_comments_preserve_strings(content)
    lines: list[str] = []
    for line in stripped.splitlines():
        text = line.strip()
        if not text or text in ("{", "}", "<?php", "?>"):
            continue
        if text.startswith("namespace ") or text.startswith("use "):
            continue
        if text.startswith("class ") or text.startswith("interface "):
            continue
        lines.append(text)
    return lines


def _has_stub_content(content: str) -> bool:
    if STUB_COMMENT_RE.search(content):
        return True
    if METHOD_ONLY_COMMENTS_RE.search(content):
        return True

    for match in EMPTY_PHP_METHOD_RE.finditer(content):
        signature = match.group(0)
        if "__construct" in signature and re.search(r"\([^)]*(private|protected|public)\s+", signature):
            continue
        return True

    meaningful = _meaningful_php_lines(content)
    if not meaningful:
        return False

    executable = [
        line for line in meaningful
        if not line.startswith(("public ", "private ", "protected ", "class ", "/**", "*"))
        or ";" in line
        or "return " in line
        or "->" in line
        or "::" in line
        or "(" in line and ")" in line and "function " not in line
    ]
    if meaningful and not executable and "function " in content:
        return True
    return False


def _edit_is_stub_only(edit: dict[str, Any]) -> bool:
    new_string = edit.get("newString") or ""
    old_string = edit.get("oldString") or ""
    if not new_string.strip():
        return True
    added = new_string
    if old_string and old_string in new_string:
        added = new_string.replace(old_string, "", 1)
    added = added.strip()
    if not added:
        return False
    if STUB_COMMENT_RE.search(added):
        return True
    if added_meaningful := _meaningful_php_lines(added):
        if all(line.strip().startswith("//") for line in added.splitlines() if line.strip()):
            return True
    return False


def validate_agent_output(cwd: str, output: dict[str, Any]) -> dict[str, list[str]]:
    """
    Validate agent output.

    Returns:
        blocking: must be fixed before apply (stubs, no files, comment-only edits)
        warnings: quality suggestions (missing tests, edit locate issues) — do not fail run-agent
    """
    blocking: list[str] = []
    warnings: list[str] = []
    files = output.get("files") or []

    if not files:
        blocking.append("No files were proposed — the task requires code changes.")
        return {"blocking": blocking, "warnings": warnings}

    has_new_php_class = False
    has_test_file = False

    for change in files:
        path = (change.get("path") or "").replace("\\", "/")
        if not path:
            continue

        if PHP_CODE_FILE_RE.search(path):
            if change.get("action") == "create" and "/Test/" not in path:
                has_new_php_class = True
        if "/Test/Unit/" in path or path.endswith("Test.php"):
            has_test_file = True

        if change.get("action") == "delete":
            continue

        for idx, edit in enumerate(change.get("edits") or [], start=1):
            if _edit_is_stub_only(edit):
                blocking.append(
                    f"{path} edit #{idx}: only adds placeholder comments — implement real PHP logic."
                )

        resolved = resolve_new_content(cwd, change)
        if resolved.get("error"):
            warnings.append(f"{path}: {resolved['error']}")
            if change.get("action") == "create" and change.get("content"):
                content = change.get("content") or ""
            else:
                continue
        else:
            content = resolved.get("content") or ""

        if PHP_CODE_FILE_RE.search(path) and content and _has_stub_content(content):
            blocking.append(
                f"{path}: contains stub/placeholder code (empty methods or '// Logic to...' comments). "
                "Write full implementation with DI, service calls, and return values."
            )

    if has_new_php_class and not has_test_file:
        warnings.append(
            "Consider adding PHPUnit tests under Test/Unit/ for new PHP classes."
        )

    return {"blocking": blocking, "warnings": warnings}


def has_blocking_issues(cwd: str, output: dict[str, Any]) -> bool:
    return bool(validate_agent_output(cwd, output)["blocking"])


def blocking_issues(cwd: str, output: dict[str, Any]) -> list[str]:
    return validate_agent_output(cwd, output)["blocking"]


def validate_deploy_fix_output(
    cwd: str,
    output: dict[str, Any],
    analysis: dict[str, Any],
    *,
    php_bin: str | None = None,
    docker_compose_path: str | None = None,
) -> dict[str, list[str]]:
    """Validate deploy-fix proposals — must target error files and apply cleanly."""
    blocking: list[str] = []
    warnings: list[str] = []
    files = output.get("files") or []
    error_files = {p.replace("\\", "/") for p in (analysis.get("errorFiles") or []) if p}

    if not files:
        blocking.append("No files were proposed for the deploy error.")
        return {"blocking": blocking, "warnings": warnings}

    proposed_paths: set[str] = set()
    for change in files:
        path = (change.get("path") or "").replace("\\", "/")
        if not path:
            continue
        proposed_paths.add(path)

        if change.get("action") == "delete":
            continue

        resolved = resolve_new_content(cwd, change)
        if resolved.get("error"):
            blocking.append(f"{path}: {resolved['error']}")
            continue

        proposed_content = resolved.get("content") or ""
        if change.get("action") == "modify":
            current = _read_if_exists(_safe_join(cwd, path))
            if current == proposed_content:
                blocking.append(
                    f"{path}: proposed fix leaves the file unchanged — deploy would fail again."
                )

        if PHP_CODE_FILE_RE.search(path) and proposed_content:
            from services.php_lint import lint_php_content_for_project

            lint_error = lint_php_content_for_project(
                cwd,
                proposed_content,
                php_bin=php_bin,
                docker_compose_path=docker_compose_path,
            )
            if lint_error:
                blocking.append(
                    f"{path}: {lint_error} — use action=modify with FULL corrected file content (not edits)."
                )
            elif _has_stub_content(proposed_content):
                blocking.append(
                    f"{path}: contains stub/placeholder PHP — write a real fix for the deploy error."
                )

    if error_files and not (proposed_paths & error_files):
        blocking.append(
            "Fix must edit at least one file named in the deploy error: "
            + ", ".join(sorted(error_files))
        )

    return {"blocking": blocking, "warnings": warnings}


def validate_test_fix_output(
    cwd: str,
    output: dict[str, Any],
    analysis: dict[str, Any],
    *,
    php_bin: str | None = None,
    docker_compose_path: str | None = None,
) -> dict[str, list[str]]:
    """Validate test-fix proposals — must target failing files and apply cleanly."""
    blocking: list[str] = []
    warnings: list[str] = []
    files = output.get("files") or []
    error_files = {p.replace("\\", "/") for p in (analysis.get("errorFiles") or []) if p}

    if not files:
        blocking.append("No files were proposed for the test failure.")
        return {"blocking": blocking, "warnings": warnings}

    proposed_paths: set[str] = set()
    for change in files:
        path = (change.get("path") or "").replace("\\", "/")
        if not path:
            continue
        proposed_paths.add(path)

        if change.get("action") == "delete":
            continue

        resolved = resolve_new_content(cwd, change)
        if resolved.get("error"):
            blocking.append(f"{path}: {resolved['error']}")
            continue

        proposed_content = resolved.get("content") or ""
        if change.get("action") == "modify":
            current = _read_if_exists(_safe_join(cwd, path))
            if current == proposed_content:
                blocking.append(
                    f"{path}: proposed fix leaves the file unchanged — tests would fail again."
                )

        if PHP_CODE_FILE_RE.search(path) and proposed_content:
            from services.php_lint import lint_php_content_for_project

            lint_error = lint_php_content_for_project(
                cwd,
                proposed_content,
                php_bin=php_bin,
                docker_compose_path=docker_compose_path,
            )
            if lint_error:
                blocking.append(
                    f"{path}: {lint_error} — use action=modify with FULL corrected file content (not edits)."
                )

    if error_files and not (proposed_paths & error_files):
        blocking.append(
            "Fix must edit at least one file named in the test failure: "
            + ", ".join(sorted(error_files)[:5])
        )

    return {"blocking": blocking, "warnings": warnings}


def _lint_php_content(php_bin: str, content: str) -> str | None:
    from services.php_lint import lint_php_content, resolve_php_lint_bin

    return lint_php_content(resolve_php_lint_bin(php_bin), content)


def lint_deploy_fix_php_syntax(
    cwd: str,
    php_bin: str,
    files: list[dict],
    selected_paths: list[str] | None,
    docker_compose_path: str | None = None,
) -> list[str]:
    """Return blocking messages when proposed deploy-fix PHP still fails php -l."""
    from services.php_lint import lint_php_content_for_project

    selected = {
        p for p in (selected_paths or [f.get("path") for f in files if f.get("path")]) if p
    }
    errors: list[str] = []
    for change in files:
        path = (change.get("path") or "").replace("\\", "/")
        if not path or path not in selected or not PHP_CODE_FILE_RE.search(path):
            continue
        resolved = resolve_new_content(cwd, change)
        if resolved.get("error"):
            continue
        lint_error = lint_php_content_for_project(
            cwd,
            resolved.get("content") or "",
            php_bin=php_bin,
            docker_compose_path=docker_compose_path,
        )
        if lint_error:
            errors.append(f"{path}: {lint_error}")
    return errors
