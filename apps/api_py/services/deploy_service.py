import os
import shutil
import subprocess
from collections.abc import Awaitable, Callable
from typing import Any
from database import now_iso
from services.deploy_profile import (
    DeployProfile,
    deploy_profile_reason,
    resolve_deploy_profile,
    should_run_composer_install,
    should_run_di_compile,
    should_run_setup_upgrade,
    should_run_static_deploy,
)
from services.docker_db import (
    DEFAULT_CONTAINER_WORKDIR,
    docker_exec_argv,
    docker_exec_shell,
    resolve_php_docker_target,
)

STEP_TIMEOUT_DEFAULT = 600
STEP_TIMEOUT_LONG = 1200
COMPOSER_TIMEOUT = 1200


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


def _build_report(
    steps: list[dict],
    *,
    profile: DeployProfile,
    profile_reason: str,
    running: bool,
    ok: bool = False,
    running_step: str | None = None,
    error: str | None = None,
) -> dict:
    return {
        "ranAt": now_iso(),
        "ok": ok,
        "running": running,
        "steps": list(steps),
        "runningStep": running_step,
        "profile": profile,
        "profileReason": profile_reason,
        "error": error,
    }


async def _emit_progress(
    steps: list[dict],
    on_progress: ProgressCallback | None,
    *,
    profile: DeployProfile,
    profile_reason: str,
    ok: bool = False,
    running: bool = True,
    running_step: str | None = None,
) -> None:
    if not on_progress:
        return
    await on_progress(
        _build_report(
            steps,
            profile=profile,
            profile_reason=profile_reason,
            ok=ok,
            running=running,
            running_step=running_step,
        )
    )


def _skipped_step(key: str, label: str, reason: str) -> dict:
    return {
        "key": key,
        "label": label,
        "ok": True,
        "skipped": True,
        "output": reason,
    }


async def _run_composer_install(runner: _DeployRunner) -> dict:
    composer_env = f"COMPOSER_PROCESS_TIMEOUT={COMPOSER_TIMEOUT} "
    if await runner.path_exists("composer.phar"):
        return await runner.run_argv(
            [runner.php_bin, "composer.phar", "install"],
            timeout=COMPOSER_TIMEOUT,
        )
    if not runner.uses_docker and shutil.which("composer"):
        return await runner.run_argv(["composer", "install"], timeout=COMPOSER_TIMEOUT)
    return await runner.run_shell(
        composer_env
        + "command -v composer >/dev/null && composer install || "
        f"{runner.php_bin} -r \"echo 'composer not found'; exit 1;\"",
        timeout=COMPOSER_TIMEOUT,
    )


async def run_local_deploy(
    cwd: str,
    php_bin: str = "php",
    docker_compose_path: str | None = None,
    on_progress: ProgressCallback | None = None,
    *,
    changed_paths: list[str] | None = None,
    project_deploy_mode: str = "auto",
    skip_composer_project: bool = False,
) -> dict:
    """Run Magento local deployment inside php-fpm Docker when available."""
    paths = changed_paths or []
    profile = resolve_deploy_profile(paths, project_deploy_mode)  # type: ignore[arg-type]
    reason = deploy_profile_reason(profile, paths)

    runner = _build_runner(cwd, php_bin, docker_compose_path)
    steps: list[dict] = []

    async def progress(
        *,
        ok: bool = False,
        running: bool = True,
        running_step: str | None = None,
    ) -> None:
        await _emit_progress(
            steps,
            on_progress,
            profile=profile,
            profile_reason=reason,
            ok=ok,
            running=running,
            running_step=running_step,
        )

    await progress(running_step="docker_target")

    if runner.uses_docker:
        steps.append({
            "key": "docker_target",
            "label": "Docker target",
            "ok": True,
            "skipped": False,
            "output": runner.docker_target["label"],
        })
        await progress(running_step="composer_install")
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
        report = _build_report(
            steps, profile=profile, profile_reason=reason, ok=False, running=False
        )
        await _emit_progress(
            steps, on_progress, profile=profile, profile_reason=reason, ok=False, running=False
        )
        return report

    run_composer = should_run_composer_install(profile, paths, skip_composer_project)
    if run_composer:
        r = await _run_composer_install(runner)
        steps.append({
            "key": "composer_install",
            "label": "Composer install",
            "ok": r["ok"],
            "skipped": False,
            "output": r["output"],
        })
        await progress(running_step="clear_generated")
        if not r["ok"]:
            return _build_report(
                steps, profile=profile, profile_reason=reason, ok=False, running=False
            )
    else:
        skip_reason = (
            "Skipped — composer.json/lock unchanged (light/standard profile)."
            if profile != "full"
            else "Skipped — project setting or no composer file changes."
        )
        steps.append(_skipped_step("composer_install", "Composer install", skip_reason))
        await progress(running_step="clear_generated")

    if profile == "light":
        clear_cmd = "rm -rf var/cache/* var/page_cache/*"
        clear_label = "Clear var/cache"
    else:
        clear_cmd = (
            "rm -rf pub/static/frontend pub/static/adminhtml pub/static/_cache/* "
            "var/cache var/composer_home var/generation var/generated var/page_cache "
            "var/view_preprocessed/* generated/code/ generated/metadata/"
        )
        clear_label = "Clear static/cache/generated"

    r = await runner.run_shell(clear_cmd, timeout=120)
    steps.append({
        "key": "clear_generated",
        "label": clear_label,
        "ok": r["ok"],
        "skipped": False,
        "output": r["output"] or "Cleared.",
    })
    await progress(running_step="setup_upgrade")
    if not r["ok"]:
        return _build_report(
            steps, profile=profile, profile_reason=reason, ok=False, running=False
        )

    has_magento = await runner.path_exists("bin/magento")
    if not has_magento:
        steps.append({
            "key": "magento_setup",
            "label": "Magento setup (bin/magento)",
            "ok": False,
            "skipped": True,
            "output": (
                f"bin/magento not found in container workdir "
                f"({runner.docker_target.get('workdir', DEFAULT_CONTAINER_WORKDIR)})."
            ),
        })
        await progress(ok=False, running=False)
        return _build_report(
            steps, profile=profile, profile_reason=reason, ok=False, running=False
        )

    magento_plan: list[tuple[str, str, list[str], int, bool]] = [
        (
            "setup_upgrade",
            "setup:upgrade",
            ["bin/magento", "setup:upgrade"],
            STEP_TIMEOUT_LONG,
            should_run_setup_upgrade(profile, paths),
        ),
        (
            "di_compile",
            "setup:di:compile",
            ["bin/magento", "setup:di:compile"],
            STEP_TIMEOUT_LONG,
            should_run_di_compile(profile),
        ),
        (
            "static_deploy",
            "setup:static-content:deploy -f",
            ["bin/magento", "setup:static-content:deploy", "-f"],
            STEP_TIMEOUT_LONG,
            should_run_static_deploy(profile, paths),
        ),
        (
            "cache_clean",
            "cache:clean",
            ["bin/magento", "cache:clean"],
            STEP_TIMEOUT_DEFAULT,
            True,
        ),
        (
            "cache_flush",
            "cache:flush",
            ["bin/magento", "cache:flush"],
            STEP_TIMEOUT_DEFAULT,
            True,
        ),
    ]

    for i, (key, label, magento_argv, timeout, should_run) in enumerate(magento_plan):
        if not should_run:
            steps.append(
                _skipped_step(
                    key,
                    label,
                    f"Skipped for {profile} profile — not required for these file changes.",
                )
            )
            next_running = "chmod_permissions"
            for nk, _, _, _, nr in magento_plan[i + 1 :]:
                if nr:
                    next_running = nk
                    break
            await progress(running_step=next_running)
            continue

        await progress(running_step=key)
        r = await runner.run_argv([runner.php_bin, *magento_argv], timeout=timeout)
        steps.append({
            "key": key,
            "label": label,
            "ok": r["ok"],
            "skipped": False,
            "output": r["output"],
        })
        if not r["ok"]:
            return _build_report(
                steps, profile=profile, profile_reason=reason, ok=False, running=False
            )
        next_running = "chmod_permissions"
        for nk, _, _, _, nr in magento_plan[i + 1 :]:
            if nr:
                next_running = nk
                break
        await progress(running_step=next_running)

    await progress(running_step="chmod_permissions")
    chmod_cmd = "chmod -R 777 var/* generated/* pub/static/* 2>/dev/null || true"
    r = await runner.run_shell(chmod_cmd, timeout=120)
    steps.append({
        "key": "chmod_permissions",
        "label": "chmod 777 (var, generated, pub/static)",
        "ok": r["ok"],
        "skipped": False,
        "output": r["output"] or "Permissions updated.",
    })

    ok = all(s["ok"] or s["skipped"] for s in steps)
    report = _build_report(
        steps, profile=profile, profile_reason=reason, ok=ok, running=False
    )
    await _emit_progress(
        steps, on_progress, profile=profile, profile_reason=reason, ok=ok, running=False
    )
    return report
