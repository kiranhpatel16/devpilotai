"""Resolve Magento Docker database hosts for health checks run on the host OS."""

import os
import re
import socket
import subprocess

from services.command_output import summarize_command_output

DOCKER_DB_SERVICE_NAMES = frozenset({"db", "mysql", "mariadb", "database", "postgres", "pgsql"})
PHP_SERVICE_CANDIDATES = ("php-fpm", "php_fpm", "phpfpm", "php", "fpm", "app", "web")
DEFAULT_CONTAINER_WORKDIR = "/var/www/html"
COMPOSE_FILENAMES = ("docker-compose.yaml", "docker-compose.yml", "compose.yaml", "compose.yml")


def find_docker_compose_file(project_root: str, override: str | None = None) -> str | None:
    if override:
        path = override if os.path.isabs(override) else os.path.join(project_root, override)
        if os.path.isfile(path):
            return path
    if not project_root:
        return None
    for name in COMPOSE_FILENAMES:
        path = os.path.join(project_root, name)
        if os.path.isfile(path):
            return path
    return None


def _service_block(content: str, service: str) -> str | None:
    match = re.search(rf"^\s{{2}}{re.escape(service)}:\s*$", content, re.MULTILINE)
    if not match:
        return None
    start = match.end()
    next_service = re.search(r"^\s{2}\w[\w-]*:\s*$", content[start:], re.MULTILINE)
    end = start + next_service.start() if next_service else len(content)
    return content[start:end]


def _detect_db_service(content: str, hint: str | None = None) -> str | None:
    if hint and _service_block(content, hint):
        return hint
    for name in ("db", "mysql", "mariadb", "database"):
        if _service_block(content, name):
            return name
    return None


def parse_compose_db_port(compose_path: str, service_hint: str | None = None) -> tuple[str, int] | None:
    try:
        with open(compose_path, encoding="utf-8") as f:
            content = f.read()
    except OSError:
        return None

    service = _detect_db_service(content, service_hint)
    if not service:
        return None

    block = _service_block(content, service)
    if not block:
        return None

    for match in re.finditer(
        r'-\s*["\']?(\d+)\s*:\s*(\d+)["\']?',
        block,
    ):
        host_port, container_port = int(match.group(1)), int(match.group(2))
        if container_port in (3306, 5432):
            return service, host_port

    for match in re.finditer(r'-\s*["\']?(\d+)["\']?\s*$', block, re.MULTILINE):
        return service, int(match.group(1))

    return service, 3306


def host_is_docker_internal(host: str) -> bool:
    if not host:
        return False
    normalized = host.strip().lower()
    if normalized in DOCKER_DB_SERVICE_NAMES:
        return True
    if normalized in ("127.0.0.1", "localhost", "::1"):
        return False
    try:
        socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
        return False
    except socket.gaierror:
        return True


def resolve_db_connect_endpoint(
    *,
    host: str,
    port: int,
    project_root: str | None,
    docker_compose_path: str | None = None,
    host_override: str | None = None,
    port_override: int | None = None,
) -> dict:
    """Map Magento-in-Docker hostnames (e.g. db) to a host-OS reachable endpoint."""
    if host_override:
        return {
            "host": host_override.strip(),
            "port": int(port_override or port or 3306),
            "via": "manual override",
            "dockerService": None,
            "composeFile": None,
        }

    compose_file = find_docker_compose_file(project_root or "", docker_compose_path)
    compose_info = parse_compose_db_port(compose_file, host) if compose_file else None
    compose_service = compose_info[0] if compose_info else None
    published_port = compose_info[1] if compose_info else None

    if host_is_docker_internal(host):
        connect_port = int(port_override or published_port or port or 3306)
        return {
            "host": "127.0.0.1",
            "port": connect_port,
            "via": f"Docker service '{host}' via localhost:{connect_port}",
            "dockerService": compose_service or host,
            "composeFile": compose_file,
        }

    return {
        "host": host,
        "port": int(port_override or port or 3306),
        "via": "direct",
        "dockerService": None,
        "composeFile": compose_file,
    }


def _docker_compose_v2_available() -> bool:
    """True only when the Docker Compose v2 plugin works (not legacy docker-compose v1)."""
    try:
        proc = subprocess.run(
            ["docker", "compose", "version"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if proc.returncode != 0:
            return False
        combined = f"{proc.stdout}\n{proc.stderr}".lower()
        return "unknown command" not in combined and "compose" in combined
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _docker_compose_cmd(compose_file: str, *args: str) -> list[str] | None:
    if not _docker_compose_v2_available():
        return None
    return ["docker", "compose", "-f", compose_file, *args]


def check_db_via_docker_exec(
    *,
    compose_file: str,
    project_root: str,
    service: str,
    user: str,
    password: str,
    database: str,
) -> dict:
    exec_args = ["exec", "-T", service, "mysql", f"-u{user}", f"-p{password}", "-e", "SELECT 1", database]
    cmd = _docker_compose_cmd(compose_file, *exec_args)
    if cmd:
        env = {**os.environ, "MYSQL_PWD": password}
        try:
            proc = subprocess.run(
                cmd,
                cwd=project_root or None,
                capture_output=True,
                text=True,
                timeout=20,
                env=env,
            )
        except FileNotFoundError:
            return {"ok": False, "detail": "docker CLI not found on this machine"}
        except subprocess.TimeoutExpired:
            return {"ok": False, "detail": "docker compose exec timed out"}

        if proc.returncode == 0:
            return {
                "ok": True,
                "detail": f"{user}@{service} (docker compose exec) /{database}",
            }
        stderr = (proc.stderr or proc.stdout or "").strip()
        return {"ok": False, "detail": stderr[:400] or "docker compose exec failed"}

    container = _find_running_container(service, "db", "mysql", "mariadb", "database")
    if not container:
        return {"ok": False, "detail": "docker compose v2 plugin not available on this machine"}

    env = {**os.environ, "MYSQL_PWD": password}
    try:
        proc = subprocess.run(
            [
                "docker", "exec",
                container,
                "mysql", f"-u{user}", f"-p{password}", "-e", "SELECT 1", database,
            ],
            capture_output=True,
            text=True,
            timeout=20,
            env=env,
        )
    except FileNotFoundError:
        return {"ok": False, "detail": "docker CLI not found on this machine"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "detail": "docker exec timed out"}

    if proc.returncode == 0:
        return {
            "ok": True,
            "detail": f"{user}@{container} (docker exec) /{database}",
        }

    stderr = (proc.stderr or proc.stdout or "").strip()
    return {"ok": False, "detail": stderr[:400] or "docker exec failed"}


def _read_compose_content(compose_path: str) -> str | None:
    try:
        with open(compose_path, encoding="utf-8") as f:
            return f.read()
    except OSError:
        return None


def detect_php_service(compose_path: str, hint: str | None = None) -> str | None:
    content = _read_compose_content(compose_path)
    if not content:
        return None
    if hint and _service_block(content, hint):
        return hint
    for name in PHP_SERVICE_CANDIDATES:
        if _service_block(content, name):
            return name
    return None


def _resolve_host_path(host: str, compose_path: str, project_root: str) -> str:
    if host in (".", "./"):
        return os.path.normpath(os.path.abspath(project_root))
    if not os.path.isabs(host):
        return os.path.normpath(os.path.abspath(os.path.join(os.path.dirname(compose_path), host)))
    return os.path.normpath(os.path.abspath(host))


def detect_container_workdir(compose_path: str, service: str, project_root: str) -> str:
    content = _read_compose_content(compose_path)
    if not content:
        return DEFAULT_CONTAINER_WORKDIR
    block = _service_block(content, service)
    if not block:
        return DEFAULT_CONTAINER_WORKDIR

    normalized_root = os.path.normpath(os.path.abspath(project_root))
    for match in re.finditer(
        r'-\s*["\']?([^:"\']+?)["\']?\s*:\s*["\']?([^:"\']+?)["\']?(?:\s|$)',
        block,
    ):
        host_raw, container_raw = match.group(1).strip(), match.group(2).strip()
        host_abs = _resolve_host_path(host_raw, compose_path, project_root)
        if host_abs == normalized_root or host_raw in (".", "./"):
            container = container_raw.split(":")[0].rstrip("/")
            return container or DEFAULT_CONTAINER_WORKDIR
    return DEFAULT_CONTAINER_WORKDIR


def _container_running(name: str) -> bool:
    try:
        proc = subprocess.run(
            ["docker", "inspect", "-f", "{{.State.Running}}", name],
            capture_output=True,
            text=True,
            timeout=10,
        )
        return proc.returncode == 0 and proc.stdout.strip().lower() == "true"
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _list_running_container_names() -> list[str]:
    try:
        proc = subprocess.run(
            ["docker", "ps", "--format", "{{.Names}}"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if proc.returncode != 0:
            return []
        return [line.strip() for line in proc.stdout.splitlines() if line.strip()]
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return []


def _find_running_container(*candidates: str | None) -> str | None:
    for name in candidates:
        if name and _container_running(name):
            return name
    names = _list_running_container_names()
    patterns = [c for c in candidates if c]
    for running in names:
        low = running.lower()
        for candidate in patterns:
            if candidate.lower() in low:
                return running
    return None


def _compose_service_running(compose_file: str, project_root: str, service: str) -> bool:
    cmd = _docker_compose_cmd(compose_file, "ps", "--status", "running", "--services")
    if not cmd:
        return False
    try:
        proc = subprocess.run(
            cmd,
            cwd=project_root or None,
            capture_output=True,
            text=True,
            timeout=20,
        )
        if proc.returncode != 0:
            return False
        running = {line.strip() for line in proc.stdout.splitlines() if line.strip()}
        return service in running
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def detect_container_workdir_from_inspect(container: str, project_root: str) -> str:
    normalized_root = os.path.normpath(os.path.abspath(project_root))
    try:
        proc = subprocess.run(
            ["docker", "inspect", "-f", "{{json .Mounts}}", container],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if proc.returncode != 0:
            return DEFAULT_CONTAINER_WORKDIR
        import json
        mounts = json.loads(proc.stdout.strip() or "[]")
        for mount in mounts:
            host_source = os.path.normpath(mount.get("Source") or "")
            if host_source == normalized_root:
                container_dest = (mount.get("Destination") or DEFAULT_CONTAINER_WORKDIR).rstrip("/")
                return container_dest or DEFAULT_CONTAINER_WORKDIR
    except Exception:
        pass
    return DEFAULT_CONTAINER_WORKDIR


def resolve_php_docker_target(
    project_root: str,
    docker_compose_path: str | None = None,
    php_service_hint: str | None = None,
) -> dict | None:
    """Pick docker compose service or container for PHP/Magento commands."""
    compose_file = find_docker_compose_file(project_root, docker_compose_path)
    service = None
    workdir = DEFAULT_CONTAINER_WORKDIR
    if compose_file:
        service = detect_php_service(compose_file, php_service_hint) or "php-fpm"
        workdir = detect_container_workdir(compose_file, service, project_root)
        if _docker_compose_v2_available() and _compose_service_running(
            compose_file, project_root, service
        ):
            return {
                "mode": "compose",
                "composeFile": compose_file,
                "service": service,
                "workdir": workdir,
                "label": f"docker compose exec {service} (workdir {workdir})",
            }

    container = _find_running_container(
        php_service_hint,
        service,
        "php-fpm",
        "php_fpm",
        "phpfpm",
        "php",
    )
    if container:
        inspected_workdir = detect_container_workdir_from_inspect(container, project_root)
        if inspected_workdir != DEFAULT_CONTAINER_WORKDIR:
            workdir = inspected_workdir
        return {
            "mode": "container",
            "container": container,
            "workdir": workdir,
            "label": f"docker exec {container} (workdir {workdir})",
        }
    return None


def docker_compose_exec(
    *,
    compose_file: str,
    project_root: str,
    service: str,
    command: list[str],
    workdir: str | None = None,
    timeout: int = 600,
) -> dict:
    exec_args = ["exec", "-T"]
    if workdir:
        exec_args.extend(["-w", workdir])
    exec_args.extend([service, *command])
    cmd = _docker_compose_cmd(compose_file, *exec_args)
    if not cmd:
        return {"ok": False, "output": "docker compose v2 plugin not available on this machine"}
    return _run_docker_cmd(cmd, project_root, timeout)


def docker_container_exec(
    *,
    container: str,
    command: list[str],
    workdir: str | None = None,
    timeout: int = 600,
) -> dict:
    # docker exec has no -T flag (unlike docker compose exec); omit -it for non-interactive runs.
    cmd = ["docker", "exec"]
    if workdir:
        cmd.extend(["-w", workdir])
    cmd.extend([container, *command])
    return _run_docker_cmd(cmd, None, timeout)


def _run_docker_cmd(cmd: list[str], cwd: str | None, timeout: int) -> dict:
    try:
        proc = subprocess.run(
            cmd,
            cwd=cwd or None,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        output = summarize_command_output(
            proc.stdout, proc.stderr, ok=proc.returncode == 0,
        )
        return {"ok": proc.returncode == 0, "output": output}
    except FileNotFoundError:
        return {"ok": False, "output": "docker CLI not found on this machine"}
    except subprocess.TimeoutExpired:
        return {"ok": False, "output": f"Command timed out after {timeout}s"}
    except Exception as exc:
        return {"ok": False, "output": str(exc)}


def docker_exec_shell(
    target: dict,
    project_root: str,
    shell_cmd: str,
    timeout: int = 600,
) -> dict:
    if target["mode"] == "compose":
        return docker_compose_exec(
            compose_file=target["composeFile"],
            project_root=project_root,
            service=target["service"],
            command=["bash", "-lc", shell_cmd],
            workdir=target.get("workdir"),
            timeout=timeout,
        )
    return docker_container_exec(
        container=target["container"],
        command=["bash", "-lc", shell_cmd],
        workdir=target.get("workdir"),
        timeout=timeout,
    )


def docker_exec_argv(
    target: dict,
    project_root: str,
    argv: list[str],
    timeout: int = 600,
) -> dict:
    if target["mode"] == "compose":
        return docker_compose_exec(
            compose_file=target["composeFile"],
            project_root=project_root,
            service=target["service"],
            command=argv,
            workdir=target.get("workdir"),
            timeout=timeout,
        )
    return docker_container_exec(
        container=target["container"],
        command=argv,
        workdir=target.get("workdir"),
        timeout=timeout,
    )
