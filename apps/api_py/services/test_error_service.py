"""Analyze test/check failures and gather context for AI-assisted fixes."""

from __future__ import annotations

import os
import re
from typing import Any

from services.prompt_budget import trim_excerpts, trim_text
from services.repo_context import _read_excerpt

PHP_PATH_RE = re.compile(r"(app/code/[^\s:'\"<>]+\.php)")
LAYOUT_PATH_RE = re.compile(r"(app/(?:design|code)/[^\s:'\"<>]+\.(?:xml|phtml))", re.IGNORECASE)
ABS_LAYOUT_PATH_RE = re.compile(
    r"/var/www/html/(app/(?:design|code)/[^\s'\"<>]+\.(?:xml|phtml))",
    re.IGNORECASE,
)
THEME_LAYOUT_FILE_RE = re.compile(
    r"layout update file\s+'(?:/var/www/html/)?([^']+\.xml)'",
    re.IGNORECASE,
)
PHPUNIT_CLASS_RE = re.compile(
    r"([\w\\]+Test(?:::[\w]+)?)",
)
PHPUNIT_LABEL_PATH_RE = re.compile(r"\(([^)]+\.php)\)")
CREATE_MOCK_PRODUCT_RE = re.compile(
    r"private function createMockProduct\(\): ProductInterface\s*\{.*?\n    \}",
    re.DOTALL,
)
ANONYMOUS_INTERFACE_RE = re.compile(r"new class implements \w+")


def infer_class_under_test(test_path: str) -> str | None:
    """Map Test/Unit/FooTest.php -> Model/Foo.php under the same module."""
    norm = test_path.replace("\\", "/")
    if "/Test/Unit/" not in norm or not norm.endswith("Test.php"):
        return None
    return norm.replace("/Test/Unit/", "/").replace("Test.php", ".php")


def build_layout_xml_auto_fix(
    cwd: str,
    analysis: dict[str, Any],
    changed_paths: list[str] | None = None,
) -> dict[str, Any] | None:
    """Escape unescaped ampersands in invalid layout XML referenced by test failures."""
    from services.layout_xml_validator import is_layout_xml_path, validate_layout_xml_content

    candidates: list[str] = list(analysis.get("errorFiles") or [])
    failed = analysis.get("failedSteps") or []
    if not candidates and "visual_smoke" in failed:
        for rel in changed_paths or []:
            if is_layout_xml_path(rel) and rel not in candidates:
                candidates.append(rel)
    if not candidates and "layout_xml_validate" in failed:
        for rel in changed_paths or []:
            if is_layout_xml_path(rel) and rel not in candidates:
                candidates.append(rel)

    proposed_files: list[dict[str, Any]] = []
    for rel in candidates:
        if not is_layout_xml_path(rel):
            continue
        content = _read_file(cwd, rel)
        if not content:
            continue
        fixed = re.sub(
            r"&(?!amp;|lt;|gt;|apos;|quot;|#\d+;|#x[0-9a-fA-F]+;)",
            "&amp;",
            content,
        )
        if fixed == content:
            continue
        if validate_layout_xml_content(fixed, rel):
            continue
        proposed_files.append({
            "path": rel,
            "action": "modify",
            "reason": "Escape unescaped '&' characters for valid Magento layout XML",
            "content": fixed,
        })

    if not proposed_files:
        return None

    return {
        "summary": "Auto-fixed layout XML: escaped unescaped '&' characters (common EntityRef errors)",
        "files": proposed_files,
        "manualTestChecklist": ["Re-run QA and confirm the homepage loads without exceptions"],
        "risks": [],
    }


def build_phpunit_auto_fix(cwd: str, analysis: dict[str, Any]) -> dict[str, Any] | None:
    """Deterministic fixes for common PHPUnit failures (no AI required)."""
    raw = analysis.get("rawOutput") or ""
    raw_lower = raw.lower()
    fatal_mock = (
        "abstract methods" in raw_lower
        or "must therefore be declared abstract" in raw_lower
        or "productinterface@anonymous" in raw_lower.replace(" ", "")
    )
    if not fatal_mock:
        return None

    proposed_files: list[dict[str, Any]] = []
    for rel in analysis.get("errorFiles") or []:
        if not rel.endswith("Test.php"):
            continue
        content = _read_file(cwd, rel)
        if not content:
            continue
        if "new class implements" not in content and "createMockProduct" not in content:
            continue
        fixed = _fix_incomplete_product_interface_mock(content)
        if fixed and fixed != content:
            proposed_files.append({
                "path": rel,
                "action": "modify",
                "reason": "Replace incomplete ProductInterface stub with PHPUnit createMock()",
                "content": fixed,
            })

    if not proposed_files:
        return None

    return {
        "summary": "Auto-fixed PHPUnit test: use createMock(ProductInterface::class) instead of an incomplete anonymous class",
        "files": proposed_files,
        "manualTestChecklist": ["Re-run PHPUnit"],
        "risks": [],
    }


def _fix_incomplete_product_interface_mock(content: str) -> str | None:
    """Replace createMockProduct() anonymous ProductInterface with createMock()."""
    if CREATE_MOCK_PRODUCT_RE.search(content):
        return CREATE_MOCK_PRODUCT_RE.sub(
            "private function createMockProduct(): ProductInterface\n"
            "    {\n"
            "        return $this->createMock(ProductInterface::class);\n"
            "    }",
            content,
            count=1,
        )
    if ANONYMOUS_INTERFACE_RE.search(content):
        return ANONYMOUS_INTERFACE_RE.sub(
            "$this->createMock(ProductInterface::class)",
            content,
            count=1,
        )
    return None


def _read_file(cwd: str, rel: str) -> str | None:
    path = os.path.join(cwd, rel)
    if not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:
        return None


def _paths_from_test_output(output: str) -> list[str]:
    paths: list[str] = []
    seen: set[str] = set()

    def add(rel: str) -> None:
        rel = rel.lstrip("/").replace("\\", "/")
        if rel and rel not in seen:
            seen.add(rel)
            paths.append(rel)

    for match in THEME_LAYOUT_FILE_RE.finditer(output or ""):
        add(match.group(1))
    for match in ABS_LAYOUT_PATH_RE.finditer(output or ""):
        add(match.group(1))
    for match in PHP_PATH_RE.finditer(output or ""):
        add(match.group(1))
    for match in LAYOUT_PATH_RE.finditer(output or ""):
        add(match.group(1))
    for match in PHPUNIT_CLASS_RE.finditer(output or ""):
        fqcn = match.group(1).split("::")[0]
        parts = fqcn.replace("\\", "/").split("/")
        if len(parts) >= 2:
            add(f"app/code/{'/'.join(parts[:-1])}/{parts[-1]}.php")
    return paths


def analyze_test_failure(test_report: dict | None) -> dict[str, Any]:
    """Build a structured summary from a failed test report."""
    if not test_report:
        return {
            "summary": "No test report available",
            "failedSteps": [],
            "errorFiles": [],
            "rawOutput": "",
            "aiFixable": False,
        }

    failed_steps = [
        s for s in (test_report.get("steps") or [])
        if not s.get("ok") and not s.get("skipped")
    ]
    if not failed_steps:
        return {
            "summary": "All checks passed",
            "failedSteps": [],
            "errorFiles": [],
            "rawOutput": "",
            "aiFixable": False,
        }

    error_files: list[str] = []
    raw_chunks: list[str] = []
    for step in failed_steps:
        output = step.get("output") or ""
        raw_chunks.append(f"=== {step.get('label', step.get('key', 'check'))} ===\n{output}")
        storefront = step.get("storefrontError")
        if isinstance(storefront, dict):
            message = storefront.get("message") or ""
            if message and not storefront.get("file"):
                from services.magento_error_parser import parse_magento_storefront_error

                parsed = parse_magento_storefront_error(message)
                if parsed:
                    storefront = {**storefront, **{k: v for k, v in parsed.items() if v is not None}}
            if storefront.get("file"):
                rel = str(storefront["file"]).lstrip("/")
                if rel not in error_files:
                    error_files.append(rel)
            if storefront.get("message"):
                raw_chunks.append(f"Storefront error: {storefront['message']}")
            for detail in storefront.get("details") or []:
                raw_chunks.append(str(detail))
        label = step.get("label") or ""
        label_match = PHPUNIT_LABEL_PATH_RE.search(label)
        if label_match:
            rel = label_match.group(1)
            error_files.append(rel)
            under_test = infer_class_under_test(rel)
            if under_test and under_test not in error_files:
                error_files.append(under_test)
        for rel in _paths_from_test_output(output):
            if rel not in error_files:
                error_files.append(rel)

    raw_output = trim_text("\n\n".join(raw_chunks), 8000)
    if not error_files:
        for rel in _paths_from_test_output(raw_output):
            if rel not in error_files:
                error_files.append(rel)

    labels = ", ".join(s.get("label", s.get("key", "?")) for s in failed_steps[:3])
    return {
        "summary": f"{len(failed_steps)} check(s) failed: {labels}",
        "failedSteps": [s.get("key") for s in failed_steps],
        "errorFiles": error_files[:8],
        "rawOutput": raw_output,
        "aiFixable": bool(error_files or raw_output.strip() or failed_steps),
    }


def gather_test_fix_excerpts(
    cwd: str,
    analysis: dict[str, Any],
    changed_paths: list[str] | None = None,
) -> list[dict[str, str]]:
    """File excerpts for test-fix — failed files plus recently changed code."""
    path_excerpts: list[dict[str, str]] = []
    seen: set[str] = set()
    raw_lower = (analysis.get("rawOutput") or "").lower()
    use_full_test_file = "fatal error" in raw_lower or "abstract methods" in raw_lower

    for rel in (analysis.get("errorFiles") or [])[:8]:
        if rel in seen:
            continue
        seen.add(rel)
        if rel.endswith("Test.php") and use_full_test_file:
            content = _read_file(cwd, rel)
            if content:
                path_excerpts.append({"path": rel, "content": content[:12_000]})
                continue
        item = _read_excerpt(cwd, rel, 6000)
        if item:
            path_excerpts.append(item)
        else:
            content = _read_file(cwd, rel)
            if content:
                path_excerpts.append({"path": rel, "content": content[:8000]})

    for rel in (changed_paths or [])[:4]:
        if rel.endswith((".php", ".xml", ".phtml")) and rel not in {e["path"] for e in path_excerpts}:
            item = _read_excerpt(cwd, rel, 3000)
            if item:
                path_excerpts.append(item)

    return trim_excerpts(path_excerpts)
