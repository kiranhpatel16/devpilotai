import os
import subprocess
from database import now_iso

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


async def run_tests(cwd: str, changed_paths: list[str], php_bin: str = "php") -> dict:
    steps = []
    php_files = [p for p in changed_paths if p.endswith(".php")]
    module_test_files = [
        p for p in changed_paths
        if "/Test/Unit/" in p.replace("\\", "/") and p.endswith("Test.php")
    ]

    # T1 — PHP lint
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
            "label": f"PHP lint ({len(php_files)} file(s))",
            "ok": lint_ok, "skipped": False,
            "output": "\n\n".join(lint_outputs)[-4000:],
        })

    # T2 — Module PHPUnit (when agent added module unit tests)
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
        # T2 — Project PHPUnit suite
        phpunit = os.path.join(cwd, "vendor", "bin", "phpunit")
        unit_config = os.path.join(cwd, "dev", "tests", "unit", "phpunit.xml.dist")
        if os.path.exists(phpunit) and os.path.exists(unit_config):
            r = await _run([phpunit, "-c", unit_config], cwd)
            steps.append({
                "key": "phpunit", "label": "PHPUnit (unit suite)",
                "ok": r["ok"], "skipped": False, "output": r["output"],
            })
        else:
            steps.append({
                "key": "phpunit", "label": "PHPUnit (unit suite)",
                "ok": True, "skipped": True,
                "output": "No module unit tests changed; project phpunit.xml.dist not found.",
            })

    # T3 — DI compile (advisory)
    steps.append({
        "key": "di_compile", "label": "DI compile (setup:di:compile)",
        "ok": True, "skipped": True,
        "output": "Skipped by default (slow). Run manually if DI XML changed.",
    })

    ok = all(s["ok"] or s["skipped"] for s in steps)
    return {"ranAt": now_iso(), "ok": ok, "steps": steps}
