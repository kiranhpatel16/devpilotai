"""Run php -l on host or inside the project's PHP docker container."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import uuid

from services.docker_db import docker_exec_argv, resolve_php_docker_target


def resolve_php_lint_bin(configured: str | None = None) -> str:
    if configured:
        if os.path.isabs(configured) and os.path.isfile(configured) and os.access(configured, os.X_OK):
            return configured
        found = shutil.which(configured)
        if found:
            return found
    return shutil.which("php") or "php"


def _is_missing_php_error(message: str) -> bool:
    low = message.lower()
    return any(
        token in low
        for token in ("no such file", "not found", "cannot find", "errno 2", "permission denied")
    )


def lint_php_content(php_bin: str, content: str) -> str | None:
    """Lint PHP source text. Returns an error message or None when valid."""
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".php", delete=False, encoding="utf-8",
    ) as tf:
        tf.write(content)
        tmp = tf.name
    try:
        result = subprocess.run(
            [php_bin, "-l", tmp], capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            return None
        message = (result.stderr or result.stdout).strip()
        return message.splitlines()[-1] if message else "PHP syntax check failed"
    except FileNotFoundError:
        return f"PHP binary not found: {php_bin}"
    except Exception as exc:
        return str(exc)
    finally:
        try:
            os.unlink(tmp)
        except OSError:
            pass


def _lint_via_docker(docker_target: dict, project_root: str, container_rel: str) -> str | None:
    workdir = docker_target.get("workdir", "/var/www/html").rstrip("/")
    argv_path = container_rel
    if not container_rel.startswith("/"):
        argv_path = f"{workdir}/{container_rel.lstrip('/')}"
    result = docker_exec_argv(
        docker_target,
        project_root,
        ["php", "-l", argv_path],
        timeout=60,
    )
    if result.get("ok"):
        return None
    output = (result.get("output") or "").strip()
    if not output:
        return "PHP syntax check failed in container"
    return output.splitlines()[-1]


def lint_php_content_for_project(
    cwd: str,
    content: str,
    *,
    php_bin: str | None = None,
    docker_compose_path: str | None = None,
) -> str | None:
    """Lint PHP using host php, then docker when host php is unavailable."""
    last_error: str | None = None
    for candidate in dict.fromkeys([resolve_php_lint_bin(php_bin), resolve_php_lint_bin(None)]):
        err = lint_php_content(candidate, content)
        if err is None:
            return None
        if not _is_missing_php_error(err):
            last_error = err

    docker_target = resolve_php_docker_target(cwd, docker_compose_path)
    if not docker_target:
        return last_error or "PHP syntax check failed"

    rel = f"var/cpwork-lint/lint-{uuid.uuid4().hex}.php"
    full = os.path.join(cwd, rel)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    try:
        with open(full, "w", encoding="utf-8") as fp:
            fp.write(content)
        return _lint_via_docker(docker_target, cwd, rel)
    finally:
        try:
            if os.path.isfile(full):
                os.unlink(full)
        except OSError:
            pass
