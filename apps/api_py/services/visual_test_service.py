"""Browser visual smoke tests via Playwright — task-aware URLs and optional customer auth."""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from typing import Any
from urllib.parse import urljoin

import config as cfg
from services.magento_error_parser import parse_magento_storefront_error

STEP_TIMEOUT_SEC = 90
VIEWPORT = "1280,900"
SCRIPT_PATH = os.path.join(os.path.dirname(__file__), "..", "scripts", "visual_smoke_capture.cjs")

# Magento storefront routes inferred from task wording.
_TASK_ROUTE_RULES: list[tuple[re.Pattern[str], str, str]] = [
    (re.compile(r"\b(login|sign[\s-]?in|log[\s-]?in)\b", re.I), "/customer/account/login", "Login page"),
    (re.compile(r"\b(register|registration|sign[\s-]?up|create[\s-]?account)\b", re.I), "/customer/account/create", "Register page"),
    (re.compile(r"\b(forgot\s+password|password\s+reset)\b", re.I), "/customer/account/forgotpassword", "Forgot password"),
    (re.compile(r"\b(checkout)\b", re.I), "/checkout", "Checkout"),
    (re.compile(r"\b(cart|shopping\s+cart)\b", re.I), "/checkout/cart", "Shopping cart"),
    (re.compile(r"\b(customer\s+account|my\s+account|account\s+dashboard)\b", re.I), "/customer/account", "Customer account"),
    (re.compile(r"\b(contact\s+us)\b", re.I), "/contact", "Contact us"),
]

_PUBLIC_CUSTOMER_PATHS = {
    "/customer/account/login",
    "/customer/account/create",
    "/customer/account/forgotpassword",
    "/customer/account/logout",
}

_PATH_IN_TEXT_RE = re.compile(r"(/[\w./?#&=%-]+)")


def screenshot_dir(run_id: str) -> str:
    return os.path.join(cfg.REPO_ROOT, "data", "runs", run_id, "screenshots")


def _is_frontend_change(path: str) -> bool:
    p = path.replace("\\", "/").lower()
    return (
        p.startswith("app/design/")
        or p.endswith(".phtml")
        or ("/layout/" in p and p.endswith(".xml"))
        or p.endswith((".css", ".less", ".scss"))
        or (p.endswith(".js") and "app/design" in p)
    )


def _slug(label: str, index: int) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")[:40]
    return slug or f"page-{index}"


def _normalize_path(path_or_url: str, base: str) -> tuple[str, str]:
    """Return (label_path, absolute_url)."""
    if path_or_url.startswith("http://") or path_or_url.startswith("https://"):
        from urllib.parse import urlparse

        parsed = urlparse(path_or_url)
        path = parsed.path or "/"
        return path, path_or_url
    path = path_or_url if path_or_url.startswith("/") else f"/{path_or_url}"
    return path, urljoin(base, path.lstrip("/"))


def _collect_task_texts(task_context: dict[str, Any] | None) -> list[str]:
    if not task_context:
        return []
    chunks: list[str] = []
    for key in (
        "userInstructions",
        "summary",
        "customTitle",
        "customRequirements",
        "jiraSummary",
        "jiraDescription",
    ):
        val = task_context.get(key)
        if isinstance(val, str) and val.strip():
            chunks.append(val.strip())

    analysis = task_context.get("requirementAnalysis")
    if isinstance(analysis, dict):
        for key in ("summary", "objective"):
            val = analysis.get(key)
            if isinstance(val, str) and val.strip():
                chunks.append(val.strip())
        for key in ("functionalRequirements", "nonFunctionalRequirements"):
            for item in analysis.get(key) or []:
                if isinstance(item, str) and item.strip():
                    chunks.append(item.strip())

    for tc in task_context.get("testCases") or []:
        if not isinstance(tc, dict):
            continue
        for key in ("title", "expected", "steps"):
            val = tc.get(key)
            if isinstance(val, str) and val.strip():
                chunks.append(val.strip())

    return chunks


def _extract_paths_from_text(text: str) -> list[tuple[str, str]]:
    """Extract explicit URL paths mentioned in checklist or task text."""
    found: list[tuple[str, str]] = []
    seen: set[str] = set()
    for match in _PATH_IN_TEXT_RE.finditer(text):
        path = match.group(1).rstrip(".,;)")
        if path in seen or path == "/":
            continue
        seen.add(path)
        label = path.strip("/").replace("/", " — ")[:50] or "Page"
        found.append((label.title(), path))
    return found


def _infer_routes_from_task_texts(texts: list[str]) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    seen_paths: set[str] = set()
    combined = " ".join(texts)
    for pattern, path, label in _TASK_ROUTE_RULES:
        if pattern.search(combined) and path not in seen_paths:
            seen_paths.add(path)
            found.append((label, path))
    return found


def _target_requires_auth(path: str) -> bool:
    norm = path.lower().rstrip("/") or "/"
    for public in _PUBLIC_CUSTOMER_PATHS:
        if norm == public.rstrip("/") or norm.endswith(public.rstrip("/")):
            return False
    if "/customer/account" in norm:
        return True
    return False


def _resolve_auth_mode(task_context: dict[str, Any] | None, targets: list[tuple[str, str]]) -> str:
    """Return none | register | login."""
    paths = [p for _, p in targets]
    if not any(_target_requires_auth(p) for p in paths):
        return "none"

    texts = _collect_task_texts(task_context)
    combined = " ".join(texts).lower()
    if re.search(r"\b(register|sign[\s-]?up|create[\s-]?account|new\s+account)\b", combined):
        return "register"
    if re.search(r"\b(login|sign[\s-]?in)\b", combined) and not re.search(
        r"\b(register|sign[\s-]?up|create[\s-]?account)\b", combined
    ):
        return "login"
    return "register"


def _test_credentials(run_id: str) -> dict[str, str]:
    token = re.sub(r"[^a-z0-9]", "", run_id.lower())[:12] or "run"
    return {
        "firstname": "CPWork",
        "lastname": "QA",
        "email": f"cpwork.qa.{token}@example.test",
        "password": "CpWork!Test123",
    }


def resolve_visual_targets(
    frontend_url: str,
    changed_paths: list[str],
    manual_test_checklist: list[str] | None,
    task_context: dict[str, Any] | None = None,
) -> list[tuple[str, str]]:
    """Return (label, path) pairs to capture — task-first, homepage only when appropriate."""
    base = frontend_url.rstrip("/") + "/"
    seen_urls: set[str] = set()
    targets: list[tuple[str, str]] = []

    def add(label: str, path_or_url: str) -> None:
        path, full = _normalize_path(path_or_url, base)
        if full in seen_urls:
            return
        seen_urls.add(full)
        targets.append((label[:50], path))

    task_texts = _collect_task_texts(task_context)

    for item in manual_test_checklist or []:
        text = item.strip()
        if not text:
            continue
        if text.startswith("http://") or text.startswith("https://"):
            add(text[:50], text)
            continue
        for label, path in _extract_paths_from_text(text):
            add(label, path)
        for label, path in _infer_routes_from_task_texts([text]):
            add(label, path)
        lower = text.lower()
        if "homepage" in lower or re.search(r"\bhome\s*page\b", lower):
            add("Homepage", "/")

    for text in task_texts:
        for label, path in _extract_paths_from_text(text):
            add(label, path)

    for label, path in _infer_routes_from_task_texts(task_texts):
        add(label, path)

    # Homepage only when task explicitly mentions it or no other targets were found.
    combined_lower = " ".join(task_texts + (manual_test_checklist or [])).lower()
    mentions_home = "homepage" in combined_lower or re.search(r"\bhome\s*page\b", combined_lower)
    has_frontend = any(_is_frontend_change(p) for p in changed_paths)

    if not targets:
        if mentions_home or has_frontend or not changed_paths:
            add("Homepage", "/")
    elif mentions_home:
        add("Homepage", "/")

    if not targets:
        add("Homepage", "/")

    return _post_filter_targets(targets, task_texts + (manual_test_checklist or []))


def _post_filter_targets(
    targets: list[tuple[str, str]],
    task_texts: list[str],
) -> list[tuple[str, str]]:
    """Drop generic customer dashboard when task only covers public login/register pages."""
    paths = {p.rstrip("/") for _, p in targets}
    if "/customer/account/login" not in paths or "/customer/account/create" not in paths:
        return targets
    if "/customer/account" not in paths:
        return targets

    combined = " ".join(task_texts).lower()
    wants_dashboard = any(
        phrase in combined
        for phrase in (
            "account dashboard",
            "my account",
            "customer dashboard",
            "account overview",
            "account home",
        )
    )
    explicit_dashboard_path = re.search(
        r"/customer/account(?!/(?:login|create|forgotpassword|logout))",
        combined,
        re.I,
    )
    if wants_dashboard or explicit_dashboard_path:
        return targets

    return [(label, path) for label, path in targets if path.rstrip("/") != "/customer/account"]


def _urls_to_visit(
    frontend_url: str,
    changed_paths: list[str],
    checklist: list[str] | None,
    task_context: dict[str, Any] | None = None,
) -> list[tuple[str, str]]:
    """Return (label, absolute_url) pairs to capture."""
    base = frontend_url.rstrip("/") + "/"
    paths = resolve_visual_targets(frontend_url, changed_paths, checklist, task_context)
    return [(label, urljoin(base, path.lstrip("/"))) for label, path in paths]


def _playwright_cli_available() -> bool:
    npx = shutil.which("npx")
    if not npx:
        return False
    try:
        result = subprocess.run(
            [npx, "playwright", "--version"],
            capture_output=True,
            text=True,
            timeout=15,
        )
        return result.returncode == 0
    except Exception:
        return False


def _find_playwright_root() -> str:
    """Directory whose node_modules contains the playwright package."""
    for base in (cfg.REPO_ROOT, os.getcwd()):
        if os.path.isdir(os.path.join(base, "node_modules", "playwright")):
            return base
    raise RuntimeError(
        "Playwright npm package not installed. From the CPWork repo root run: "
        "npm install && npx playwright install chromium"
    )


def _run_playwright_capture(config: dict[str, Any]) -> dict[str, Any]:
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node not found")

    script = os.path.abspath(SCRIPT_PATH)
    if not os.path.isfile(script):
        raise RuntimeError(f"Playwright capture script missing: {script}")

    pw_root = _find_playwright_root()

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tmp:
        json.dump(config, tmp)
        config_path = tmp.name

    try:
        result = subprocess.run(
            [node, script, config_path],
            cwd=pw_root,
            capture_output=True,
            text=True,
            timeout=STEP_TIMEOUT_SEC * max(len(config.get("targets") or []), 1) + 60,
        )
        if result.returncode != 0:
            err = (result.stderr or result.stdout or "").strip()
            raise RuntimeError(err or f"Playwright capture exited {result.returncode}")
        stdout = result.stdout.strip()
        if not stdout:
            raise RuntimeError("Playwright capture returned no output")
        return json.loads(stdout)
    finally:
        try:
            os.unlink(config_path)
        except OSError:
            pass


def _http_probe(url: str) -> tuple[bool, str, str | None]:
    try:
        req = urllib.request.Request(url, method="GET", headers={"User-Agent": "CPWork-VisualSmoke/1.0"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            status = resp.getcode()
            body = resp.read(120_000).decode("utf-8", errors="replace")
            parsed = parse_magento_storefront_error(body)
            if parsed:
                detail = f"HTTP {status} — Magento storefront error\n{_format_storefront_error(parsed)}"
                return False, detail, body
            if status >= 400:
                return False, f"HTTP {status}", body
            return True, f"HTTP {status}", None
    except urllib.error.HTTPError as e:
        body = e.read(120_000).decode("utf-8", errors="replace")
        parsed = parse_magento_storefront_error(body)
        if parsed:
            detail = f"HTTP {e.code} — Magento storefront error\n{_format_storefront_error(parsed)}"
            return False, detail, body
        return False, f"HTTP {e.code}", body
    except Exception as e:
        return False, str(e), None


def probe_storefront_health(frontend_url: str) -> tuple[bool, str]:
    """HTTP GET homepage (or base URL) and fail on Magento exception pages."""
    base = frontend_url.rstrip("/") + "/"
    ok, detail, _body = _http_probe(base)
    if ok:
        return True, f"Homepage OK — {detail}"
    return False, detail


def _format_storefront_error(parsed: dict) -> str:
    lines = []
    if parsed.get("type"):
        lines.append(f"Exception: {parsed['type']}")
    if parsed.get("message"):
        lines.append(str(parsed["message"]))
    if parsed.get("file"):
        line = parsed.get("line")
        lines.append(f"File: {parsed['file']}" + (f" (line {line})" if line else ""))
    for detail in parsed.get("details") or []:
        lines.append(f"  • {detail}")
    return "\n".join(lines)


def _capture_sync(url: str, dest_path: str) -> tuple[bool, str, dict | None]:
    """Legacy single-URL CLI capture (fallback)."""
    npx = shutil.which("npx")
    if not npx:
        return False, "npx not found. Install Node.js, then run: npx playwright install chromium", None

    os.makedirs(os.path.dirname(dest_path), exist_ok=True)
    http_ok, http_detail, error_body = _http_probe(url)
    storefront_error = parse_magento_storefront_error(error_body) if error_body else None

    cmd = [
        npx,
        "playwright",
        "screenshot",
        "--wait-for-timeout=1500",
        "--full-page",
        f"--viewport-size={VIEWPORT}",
        url,
        dest_path,
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=STEP_TIMEOUT_SEC)
        output = (result.stdout + result.stderr).strip()
        if result.returncode != 0:
            hint = output or f"exit {result.returncode}"
            if "browser" in hint.lower() or "executable" in hint.lower():
                hint += " — run: npx playwright install chromium"
            return False, hint, storefront_error
        if not os.path.isfile(dest_path):
            return False, "Screenshot file was not created", storefront_error
        ok = http_ok
        detail = f"{http_detail}; screenshot saved"
        if storefront_error and not ok:
            detail = f"{http_detail}\n{_format_storefront_error(storefront_error)}"
        return ok, detail, storefront_error
    except subprocess.TimeoutExpired:
        return False, "Screenshot timed out", storefront_error
    except Exception as e:
        return False, str(e), storefront_error


def merge_visual_screenshot_history(prior_step: dict | None, new_step: dict) -> dict:
    if not prior_step:
        return new_step

    prior_current = list(prior_step.get("screenshots") or [])
    prior_history = list(prior_step.get("screenshotHistory") or [])
    new_current = list(new_step.get("screenshots") or [])

    seen_paths = {s.get("path") for s in new_current if s.get("path")}
    history: list[dict] = []

    for shot in prior_history + prior_current:
        path = shot.get("path")
        if not path or path in seen_paths:
            continue
        seen_paths.add(path)
        history.append(shot)

    if history:
        new_step["screenshotHistory"] = history[-12:]
    return new_step


async def run_visual_smoke(
    *,
    frontend_url: str | None,
    run_id: str | None,
    changed_paths: list[str],
    manual_test_checklist: list[str] | None = None,
    prior_visual_step: dict | None = None,
    task_context: dict[str, Any] | None = None,
) -> dict:
    """Run browser screenshots; returns a test step dict."""
    if not frontend_url:
        return {
            "key": "visual_smoke",
            "label": "Visual smoke (browser screenshots)",
            "ok": True,
            "skipped": True,
            "output": "No frontend URL configured for this project environment.",
            "screenshots": [],
        }
    if not run_id:
        return {
            "key": "visual_smoke",
            "label": "Visual smoke (browser screenshots)",
            "ok": True,
            "skipped": True,
            "output": "Run ID required for screenshot storage.",
            "screenshots": [],
        }

    if not shutil.which("npx"):
        return {
            "key": "visual_smoke",
            "label": "Visual smoke (browser screenshots)",
            "ok": True,
            "skipped": True,
            "output": "Node.js/npx not found. Install Node.js, then run: npx playwright install chromium",
            "screenshots": [],
        }

    if not await asyncio.to_thread(_playwright_cli_available):
        return {
            "key": "visual_smoke",
            "label": "Visual smoke (browser screenshots)",
            "ok": True,
            "skipped": True,
            "output": "Playwright CLI not available. Run once: npx playwright install chromium",
            "screenshots": [],
        }

    path_targets = resolve_visual_targets(
        frontend_url, changed_paths, manual_test_checklist, task_context,
    )
    auth_mode = _resolve_auth_mode(task_context, path_targets)
    out_dir = screenshot_dir(run_id)
    os.makedirs(out_dir, exist_ok=True)
    capture_ts = int(time.time())

    pw_targets: list[dict[str, Any]] = []
    for idx, (label, path) in enumerate(path_targets):
        slug = _slug(label, idx)
        filename = f"{slug}-{capture_ts}.png"
        pw_targets.append({
            "label": label,
            "path": path,
            "outputPath": os.path.join(out_dir, filename),
            "filename": filename,
        })

    capture_config: dict[str, Any] = {
        "baseUrl": frontend_url,
        "runId": run_id,
        "viewport": {"width": 1280, "height": 900},
        "waitMs": 1200,
        "targets": pw_targets,
        "auth": {"mode": auth_mode},
    }
    if auth_mode != "none":
        capture_config["auth"]["credentials"] = _test_credentials(run_id)

    screenshots: list[dict] = []
    lines: list[str] = []
    all_ok = True
    storefront_errors: list[dict] = []

    try:
        report = await asyncio.to_thread(_run_playwright_capture, capture_config)
        for item, meta in zip(report.get("results") or [], pw_targets):
            label = item.get("label") or meta["label"]
            url = item.get("url") or urljoin(frontend_url.rstrip("/") + "/", meta["path"].lstrip("/"))
            ok = bool(item.get("ok"))
            detail = item.get("detail") or ("OK" if ok else "FAIL")
            if not ok:
                all_ok = False
            parsed = item.get("storefrontError")
            if isinstance(parsed, dict) and parsed.get("message") and not parsed.get("file"):
                enriched = parse_magento_storefront_error(parsed["message"])
                if enriched:
                    parsed = {**parsed, **{k: v for k, v in enriched.items() if v is not None}}
            if parsed:
                storefront_errors.append(parsed)
            lines.append(f"{label} ({url}): {'OK' if ok else 'FAIL'} — {detail}")
            out_file = meta["outputPath"]
            if os.path.isfile(out_file):
                screenshots.append({
                    "label": label,
                    "url": url,
                    "path": f"/runs/{run_id}/screenshots/{meta['filename']}",
                    "capturedAt": capture_ts,
                })
    except Exception as exc:
        # Fallback to simple CLI capture without auth/modal handling.
        lines.append(f"Playwright flow failed ({exc}); falling back to basic capture.")
        for idx, (label, path) in enumerate(path_targets):
            slug = _slug(label, idx)
            filename = f"{slug}-{capture_ts}-fb.png"
            dest = os.path.join(out_dir, filename)
            url = urljoin(frontend_url.rstrip("/") + "/", path.lstrip("/"))
            ok, detail, parsed_error = await asyncio.to_thread(_capture_sync, url, dest)
            if not ok:
                all_ok = False
            if parsed_error:
                storefront_errors.append(parsed_error)
            lines.append(f"{label} ({url}): {'OK' if ok else 'FAIL'} — {detail}")
            if os.path.isfile(dest):
                screenshots.append({
                    "label": label,
                    "url": url,
                    "path": f"/runs/{run_id}/screenshots/{filename}",
                    "capturedAt": capture_ts,
                })

    if auth_mode != "none":
        lines.insert(0, f"Customer auth: {auth_mode} (test account for protected pages)")

    primary_error = storefront_errors[0] if storefront_errors else None
    output_text = "\n".join(lines)[-4000:]
    if primary_error:
        formatted_error = _format_storefront_error(primary_error)
        if formatted_error and formatted_error not in output_text:
            output_text = (formatted_error + "\n\n" + output_text)[-4000:]

    target_summary = ", ".join(t["label"] for t in pw_targets[:4])
    step: dict = {
        "key": "visual_smoke",
        "label": f"Visual smoke ({len(screenshots)} screenshot(s))",
        "ok": all_ok,
        "skipped": False,
        "output": output_text,
        "screenshots": screenshots,
    }
    if target_summary:
        step["output"] = f"Targets: {target_summary}\n\n{step['output']}"[-4000:]
    if primary_error:
        step["storefrontError"] = primary_error

    if not screenshots and not all_ok:
        step["label"] = "Visual smoke (browser screenshots)"
        return merge_visual_screenshot_history(prior_visual_step, step)

    return merge_visual_screenshot_history(prior_visual_step, step)
