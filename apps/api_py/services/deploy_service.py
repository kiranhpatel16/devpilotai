import os
import shutil
import subprocess
from collections.abc import Awaitable, Callable
from typing import Any
from database import now_iso
from services.docker_db import (
    DEFAULT_CONTAINER_WORKDIR,
    docker_exec_argv,
    docker_exec_shell,
    resolve_php_docker_target,
)

STEP_TIMEOUT_DEFAULT = 600
STEP_TIMEOUT_LONG = 1200


class _DeployRunner:
    def __init__(
        self,
        *,
        project_root: str,
        php_bin: str,
        docker_target: dict | None = None,
    ):
        self.project_root = project_root
        self.php_bin = php_bin
        self.docker_target = docker_target

    @property
    def uses_docker(self) -> bool:
        return self.docker_target is not None

    async def run_shell(self, cmd: str, timeout: int = STEP_TIMEOUT_DEFAULT) -> dict:
        if self.docker_target:
            return docker_exec_shell(self.docker_target, self.project_root, cmd, timeout=timeout)
        return await _run_shell(cmd, self.project_root, timeout=timeout)

    async def run_argv(self, argv: list[str], timeout: int = STEP_TIMEOUT_DEFAULT) -> dict:
        if self.docker_target:
            return docker_exec_argv(self.docker_target, self.project_root, argv, timeout=timeout)
        return await _run(argv, self.project_root, timeout=timeout)

    async def path_exists(self, rel_path: str) -> bool:
        if self.docker_target:
            r = await self.run_argv(["test", "-e", rel_path], timeout=30)
            return r["ok"]
        return os.path.exists(os.path.join(self.project_root, rel_path))


async def _run_shell(cmd: str, cwd: str, timeout: int = STEP_TIMEOUT_DEFAULT) -> dict:
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        output = (result.stdout + result.stderr)[-8000:]
        return {"ok": result.returncode == 0, "output": output}
    except subprocess.TimeoutExpired:
        return {"ok": False, "output": f"Command timed out after {timeout}s"}
    except Exception as e:
        return {"ok": False, "output": str(e)}


async def _run(cmd: list[str], cwd: str, timeout: int = STEP_TIMEOUT_DEFAULT) -> dict:
    try:
        result = subprocess.run(
            cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout
        )
        output = (result.stdout + result.stderr)[-8000:]
        return {"ok": result.returncode == 0, "output": output}
    except subprocess.TimeoutExpired:
        return {"ok": False, "output": f"Command timed out after {timeout}s"}
    except Exception as e:
        return {"ok": False, "output": str(e)}


def _build_runner(
    cwd: str,
    php_bin: str,
    docker_compose_path: str | None = None,
) -> _DeployRunner:
    docker_target = resolve_php_docker_target(cwd, docker_compose_path)
    return _DeployRunner(
        project_root=cwd,
        php_bin=php_bin if not docker_target else "php",
        docker_target=docker_target,
    )


ProgressCallback = Callable[[dict[str, Any]], Awaitable[None]]


async def _emit_progress(
    steps: list[dict],
    on_progress: ProgressCallback | None,
    *,
    ok: bool = False,
    running: bool = True,
) -> None:
    if not on_progress:
        return
    await on_progress({
        "ranAt": now_iso(),
        "ok": ok,
        "running": running,
        "steps": list(steps),
    })


async def run_local_deploy(
    cwd: str,
    php_bin: str = "php",
    docker_compose_path: str | None = None,
    on_progress: ProgressCallback | None = None,
) -> dict:
    """Run Magento local deployment inside php-fpm Docker when available."""
    runner = _build_runner(cwd, php_bin, docker_compose_path)
    steps: list[dict] = []

    async def progress(ok: bool = False, running: bool = True) -> None:
        await _emit_progress(steps, on_progress, ok=ok, running=running)

    if runner.uses_docker:
        steps.append({
            "key": "docker_target",
            "label": "Docker target",
            "ok": True,
            "skipped": False,
            "output": runner.docker_target["label"],
        })
        await progress()
    else:
        steps.append({
            "key": "docker_target",
            "label": "Docker target",
            "ok": False,
            "skipped": False,
            "output": (
                "No running php-fpm container found. "
                "Start Docker (docker compose up -d php-fpm) or set docker-compose path in My Environments."
            ),
        })
        report = {"ranAt": now_iso(), "ok": False, "running": False, "steps": steps}
        await _emit_progress(steps, on_progress, ok=False, running=False)
        return report

    has_composer_phar = await runner.path_exists("composer.phar")
    if has_composer_phar:
        r = await runner.run_argv(
            [runner.php_bin, "composer.phar", "install"],
            timeout=STEP_TIMEOUT_LONG,
        )
        steps.append({
            "key": "composer_install",
            "label": "Composer install",
            "ok": r["ok"],
            "skipped": False,
            "output": r["output"],
        })
        await progress()
        if not r["ok"]:
            return {"ranAt": now_iso(), "ok": False, "running": False, "steps": steps}
    elif not runner.uses_docker and shutil.which("composer"):
        r = await runner.run_argv(["composer", "install"], timeout=STEP_TIMEOUT_LONG)
        steps.append({
            "key": "composer_install",
            "label": "Composer install",
            "ok": r["ok"],
            "skipped": False,
            "output": r["output"],
        })
        await progress()
        if not r["ok"]:
            return {"ranAt": now_iso(), "ok": False, "running": False, "steps": steps}
    else:
        r = await runner.run_shell(
            "command -v composer >/dev/null && composer install || "
            f"{runner.php_bin} -r \"echo 'composer not found'; exit 1;\"",
            timeout=STEP_TIMEOUT_LONG,
        )
        steps.append({
            "key": "composer_install",
            "label": "Composer install",
            "ok": r["ok"],
            "skipped": False,
            "output": r["output"],
        })
        await progress()
        if not r["ok"]:
            return {"ranAt": now_iso(), "ok": False, "running": False, "steps": steps}

    clear_cmd = (
        "rm -rf pub/static/frontend pub/static/adminhtml pub/static/_cache/* "
        "var/cache var/composer_home var/generation var/generated var/page_cache "
        "var/view_preprocessed/* generated/code/ generated/metadata/"
    )
    r = await runner.run_shell(clear_cmd, timeout=120)
    steps.append({
        "key": "clear_generated",
        "label": "Clear static/cache/generated",
        "ok": r["ok"],
        "skipped": False,
        "output": r["output"] or "Cleared.",
    })
    await progress()
    if not r["ok"]:
        return {"ranAt": now_iso(), "ok": False, "running": False, "steps": steps}

    has_magento = await runner.path_exists("bin/magento")
    if not has_magento:
        steps.append({
            "key": "magento_setup",
            "label": "Magento setup (bin/magento)",
            "ok": False,
            "skipped": True,
            "output": f"bin/magento not found in container workdir ({runner.docker_target.get('workdir', DEFAULT_CONTAINER_WORKDIR)}).",
        })
        await progress(ok=False, running=False)
        return {"ranAt": now_iso(), "ok": False, "running": False, "steps": steps}

    magento_steps = [
        ("setup_upgrade", "setup:upgrade", ["bin/magento", "setup:upgrade"], STEP_TIMEOUT_LONG),
        ("di_compile", "setup:di:compile", ["bin/magento", "setup:di:compile"], STEP_TIMEOUT_LONG),
        (
            "static_deploy",
            "setup:static-content:deploy -f",
            ["bin/magento", "setup:static-content:deploy", "-f"],
            STEP_TIMEOUT_LONG,
        ),
        ("cache_clean", "cache:clean", ["bin/magento", "cache:clean"], STEP_TIMEOUT_DEFAULT),
        ("cache_flush", "cache:flush", ["bin/magento", "cache:flush"], STEP_TIMEOUT_DEFAULT),
    ]

    for key, label, magento_argv, timeout in magento_steps:
        r = await runner.run_argv([runner.php_bin, *magento_argv], timeout=timeout)
        steps.append({
            "key": key,
            "label": label,
            "ok": r["ok"],
            "skipped": False,
            "output": r["output"],
        })
        await progress()
        if not r["ok"]:
            return {"ranAt": now_iso(), "ok": False, "running": False, "steps": steps}

    chmod_cmd = "chmod -R 777 var/* generated/* pub/static/*"
    r = await runner.run_shell(chmod_cmd, timeout=120)
    steps.append({
        "key": "chmod_permissions",
        "label": "chmod 777 (var, generated, pub/static)",
        "ok": r["ok"],
        "skipped": False,
        "output": r["output"] or "Permissions updated.",
    })

    await progress()
    ok = all(s["ok"] or s["skipped"] for s in steps)
    report = {"ranAt": now_iso(), "ok": ok, "running": False, "steps": steps}
    await _emit_progress(steps, on_progress, ok=ok, running=False)
    return report
