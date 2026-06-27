import os
import shutil
import subprocess
from database import now_iso

from services.visual_test_service import run_visual_smoke, _is_frontend_change
from services.layout_xml_validator import is_layout_xml_path, validate_layout_xml_files

STEP_TIMEOUT = 120


async def _run(cmd: list[str], cwd: str) -> dict:
    try:
        result = subprocess.run(
            cmd, cwd=cwd, capture_output=True, text=True, timeout=STEP_TIMEOUT
        )
        output = (result.stdout + result.stderr)[-4000:]
        return {"ok": result.returncode == 0, "output": output}
    except subprocess.TimeoutExpired:
        return {"ok": False, "output": "Command timed out"}
    except Exception as e:
        return {"ok": False, "output": str(e)}


async def run_tests(
    cwd: str,
    changed_paths: list[str],
    php_bin: str = "php",
    *,
    frontend_url: str | None = None,
    run_id: str | None = None,
    manual_test_checklist: list[str] | None = None,
    prior_test: dict | None = None,
    task_context: dict | None = None,
) -> dict:
    steps = []
    php_files = [p for p in changed_paths if p.endswith(".php")]
    module_test_files = [
        p for p in changed_paths
        if "/Test/Unit/" in p.replace("\\", "/") and p.endswith("Test.php")
    ]

    # T1 — PHP lint (changed .php files only)
    if not php_files:
        steps.append({
            "key": "php_lint", "label": "PHP lint (php -l)",
            "ok": True, "skipped": True, "output": "No PHP files changed.",
        })
    else:
        lint_outputs = []
        lint_ok = True
        for rel in php_files:
            r = await _run([php_bin, "-l", os.path.join(cwd, rel)], cwd)
            if not r["ok"]:
                lint_ok = False
            lint_outputs.append(f"{rel}: {'OK' if r['ok'] else 'FAIL'}\n{r['output']}")
        steps.append({
            "key": "php_lint",
            "label": f"PHP lint ({len(php_files)} changed file(s))",
            "ok": lint_ok, "skipped": False,
            "output": "\n\n".join(lint_outputs)[-4000:],
        })

    # T2 — Layout XML validation (theme/layout changes)
    layout_paths = [p for p in changed_paths if is_layout_xml_path(p)]
    if layout_paths:
        layout_ok, layout_output = validate_layout_xml_files(cwd, layout_paths)
        steps.append({
            "key": "layout_xml_validate",
            "label": f"Layout XML validation ({len(layout_paths)} file(s))",
            "ok": layout_ok,
            "skipped": False,
            "output": layout_output,
        })
    else:
        steps.append({
            "key": "layout_xml_validate",
            "label": "Layout XML validation",
            "ok": True,
            "skipped": True,
            "output": "No layout XML files changed.",
        })

    # T3 — PHPUnit (only changed module unit test files)
    if module_test_files:
        phpunit = os.path.join(cwd, "vendor", "bin", "phpunit")
        for rel in module_test_files:
            r = await _run([php_bin, phpunit, rel], cwd)
            steps.append({
                "key": f"phpunit_{rel.replace('/', '_')}",
                "label": f"PHPUnit ({rel})",
                "ok": r["ok"],
                "skipped": False,
                "output": r["output"],
            })
    else:
        steps.append({
            "key": "phpunit",
            "label": "PHPUnit (unit tests)",
            "ok": True,
            "skipped": True,
            "output": "Skipped — no changed Test/Unit/*Test.php files. Full project suite is not run automatically.",
        })

    # T3 — DI compile (advisory)
    steps.append({
        "key": "di_compile", "label": "DI compile (setup:di:compile)",
        "ok": True, "skipped": True,
        "output": "Skipped by default (slow). Run manually if DI XML changed.",
    })

    # T4 — Visual smoke (Playwright screenshots)
    prior_visual = None
    if prior_test:
        prior_visual = next(
            (s for s in (prior_test.get("steps") or []) if s.get("key") == "visual_smoke"),
            None,
        )
    visual_step = await run_visual_smoke(
        frontend_url=frontend_url,
        run_id=run_id,
        changed_paths=changed_paths,
        manual_test_checklist=manual_test_checklist,
        prior_visual_step=prior_visual,
        task_context=task_context,
    )
    needs_storefront = any(_is_frontend_change(p) for p in changed_paths)
    if needs_storefront and frontend_url and visual_step.get("skipped"):
        visual_step = {
            **visual_step,
            "ok": False,
            "skipped": False,
            "output": (
                (visual_step.get("output") or "")
                + "\n\nStorefront verification is required for theme/layout changes. "
                "Configure a frontend URL and install Playwright (npx playwright install chromium)."
            ).strip(),
        }
    steps.append(visual_step)

    ok = all(s["ok"] for s in steps if not s.get("skipped"))
    return {"ranAt": now_iso(), "ok": ok, "steps": steps}


PLAYWRIGHT_TIMEOUT = 600


def _playwright_config_exists(cwd: str) -> bool:
    for name in ("playwright.config.ts", "playwright.config.js", "playwright.config.mjs"):
        if os.path.isfile(os.path.join(cwd, name)):
            return True
    return False


async def run_playwright_suite(cwd: str) -> dict:
    """Run project Playwright test suite when playwright.config.* exists."""
    if not _playwright_config_exists(cwd):
        return {
            "key": "playwright_suite",
            "label": "Playwright (project suite)",
            "ok": True,
            "skipped": True,
            "output": "No playwright.config.* found — skipped.",
        }
    npx = shutil.which("npx")
    if not npx:
        return {
            "key": "playwright_suite",
            "label": "Playwright (project suite)",
            "ok": False,
            "skipped": False,
            "output": "npx not found. Install Node.js to run Playwright tests.",
        }
    try:
        result = subprocess.run(
            [npx, "playwright", "test", "--reporter=line"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=PLAYWRIGHT_TIMEOUT,
        )
        output = (result.stdout + result.stderr)[-8000:]
        return {
            "key": "playwright_suite",
            "label": "Playwright (project suite)",
            "ok": result.returncode == 0,
            "skipped": False,
            "output": output,
        }
    except subprocess.TimeoutExpired:
        return {
            "key": "playwright_suite",
            "label": "Playwright (project suite)",
            "ok": False,
            "skipped": False,
            "output": f"Playwright timed out after {PLAYWRIGHT_TIMEOUT}s",
        }
    except Exception as e:
        return {
            "key": "playwright_suite",
            "label": "Playwright (project suite)",
            "ok": False,
            "skipped": False,
            "output": str(e),
        }


async def run_qa_pipeline(
    cwd: str,
    changed_paths: list[str],
    php_bin: str = "php",
    *,
    frontend_url: str | None = None,
    run_id: str | None = None,
    manual_test_checklist: list[str] | None = None,
    prior_test: dict | None = None,
    task_context: dict | None = None,
) -> dict:
    """QA step: standard checks plus full Playwright suite when available."""
    report = await run_tests(
        cwd,
        changed_paths,
        php_bin,
        frontend_url=frontend_url,
        run_id=run_id,
        manual_test_checklist=manual_test_checklist,
        prior_test=prior_test,
        task_context=task_context,
    )
    pw_step = await run_playwright_suite(cwd)
    report["steps"] = list(report.get("steps") or []) + [pw_step]
    report["ok"] = all(s["ok"] for s in report["steps"] if not s.get("skipped"))
    report["ranAt"] = now_iso()
    return report

