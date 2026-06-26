"""Browser visual smoke tests via Playwright CLI — screenshots for storefront verification."""

from __future__ import annotations

import asyncio
import os
import re
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from urllib.parse import urljoin

import config as cfg
from services.magento_error_parser import parse_magento_storefront_error

STEP_TIMEOUT_SEC = 55
VIEWPORT = "1280,900"


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


def _urls_to_visit(
    frontend_url: str,
    changed_paths: list[str],
    checklist: list[str] | None,
) -> list[tuple[str, str]]:
    """Return (label, absolute_url) pairs to capture."""
    base = frontend_url.rstrip("/") + "/"
    seen: set[str] = set()
    urls: list[tuple[str, str]] = []

    def add(label: str, path_or_url: str) -> None:
        if path_or_url.startswith("http://") or path_or_url.startswith("https://"):
            full = path_or_url
        else:
            path = path_or_url if path_or_url.startswith("/") else f"/{path_or_url}"
            full = urljoin(base, path.lstrip("/"))
        if full in seen:
            return
        seen.add(full)
        urls.append((label, full))

    has_frontend = any(_is_frontend_change(p) for p in changed_paths)
    if has_frontend or not changed_paths:
        add("Homepage", "/")

    for item in checklist or []:
        text = item.strip()
        if not text:
            continue
        if text.startswith("http://") or text.startswith("https://"):
            add(text[:50], text)
            continue
        path_match = re.search(r"(/[\w./-]+)", text)
        if path_match:
            add(text[:50], path_match.group(1))
            continue
        lower = text.lower()
        if "homepage" in lower or re.search(r"\bhome\s*page\b", lower):
            add("Homepage (checklist)", "/")

    if not urls:
        add("Homepage", "/")
    return urls


def _http_probe(url: str) -> tuple[bool, str, str | None]:
    """Return (ok, detail, html_body_on_error)."""
    try:
        req = urllib.request.Request(url, method="GET", headers={"User-Agent": "CPWork-VisualSmoke/1.0"})
        with urllib.request.urlopen(req, timeout=20) as resp:
            status = resp.getcode()
            body = resp.read(120_000).decode("utf-8", errors="replace") if status >= 400 else None
            return status < 400, f"HTTP {status}", body
    except urllib.error.HTTPError as e:
        body = e.read(120_000).decode("utf-8", errors="replace")
        return False, f"HTTP {e.code}", body
    except Exception as e:
        return False, str(e), None


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
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=STEP_TIMEOUT_SEC,
        )
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


def merge_visual_screenshot_history(prior_step: dict | None, new_step: dict) -> dict:
    """Keep prior screenshots in screenshotHistory when re-running visual smoke."""
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

    targets = _urls_to_visit(frontend_url, changed_paths, manual_test_checklist)
    out_dir = screenshot_dir(run_id)
    os.makedirs(out_dir, exist_ok=True)

    screenshots: list[dict] = []
    lines: list[str] = []
    all_ok = True
    storefront_errors: list[dict] = []
    capture_ts = int(time.time())

    for idx, (label, url) in enumerate(targets):
        slug = _slug(label, idx)
        filename = f"{slug}-{capture_ts}.png"
        dest = os.path.join(out_dir, filename)
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

    primary_error = storefront_errors[0] if storefront_errors else None
    output_text = "\n".join(lines)[-4000:]
    if primary_error:
        formatted_error = _format_storefront_error(primary_error)
        if formatted_error and formatted_error not in output_text:
            output_text = (formatted_error + "\n\n" + output_text)[-4000:]

    step: dict = {
        "key": "visual_smoke",
        "label": f"Visual smoke ({len(screenshots)} screenshot(s))",
        "ok": all_ok,
        "skipped": False,
        "output": output_text,
        "screenshots": screenshots,
    }
    if primary_error:
        step["storefrontError"] = primary_error

    if not screenshots and not all_ok:
        step["label"] = "Visual smoke (browser screenshots)"
        return merge_visual_screenshot_history(prior_visual_step, step)

    return merge_visual_screenshot_history(prior_visual_step, step)
