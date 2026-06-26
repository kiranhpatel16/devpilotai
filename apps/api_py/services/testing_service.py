import os
import subprocess
from database import now_iso

from services.visual_test_service import run_visual_smoke

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

    # T2 — PHPUnit (only changed module unit test files)
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
    )
    steps.append(visual_step)

    ok = all(s["ok"] or s["skipped"] for s in steps)
    return {"ranAt": now_iso(), "ok": ok, "steps": steps}
