import os
import re
from lib.errors import HttpError
from db.projects import projects_repo
from db.environments import environments_repo
from services.docker_db import (
    check_db_via_docker_exec,
    find_docker_compose_file,
    resolve_db_connect_endpoint,
)


def read_magento_db_config(project_root: str) -> dict | None:
    """Read host/port/dbname/user/password from Magento app/etc/env.php when present."""
    env_php = os.path.join(project_root, "app", "etc", "env.php")
    if not os.path.isfile(env_php):
        return None
    try:
        with open(env_php, encoding="utf-8") as f:
            content = f.read()
    except OSError:
        return None

    def _pick(key: str) -> str | None:
        match = re.search(rf"['\"]{key}['\"]\s*=>\s*['\"]((?:\\.|[^'\"])*)['\"]", content)
        if not match:
            return None
        return match.group(1).encode().decode("unicode_escape")

    host = _pick("host")
    dbname = _pick("dbname")
    username = _pick("username")
    password = _pick("password")
    port_raw = _pick("port")
    port = int(port_raw) if port_raw and port_raw.isdigit() else 3306
    if not any([host, dbname, username]):
        return None
    return {
        "host": host or "localhost",
        "port": port,
        "dbname": dbname,
        "username": username,
        "password": password,
    }


def detect_database_config(project_root: str, docker_compose_path: str | None = None) -> dict | None:
    """Best-effort DB settings from env.php + docker-compose for UI auto-fill."""
    if not project_root or not os.path.isdir(project_root):
        return None

    magento_db = read_magento_db_config(project_root)
    if not magento_db:
        return None

    compose_file = find_docker_compose_file(project_root, docker_compose_path)
    endpoint = resolve_db_connect_endpoint(
        host=magento_db["host"],
        port=magento_db["port"],
        project_root=project_root,
        docker_compose_path=docker_compose_path,
    )

    return {
        "source": "magento_env_php",
        "magentoHost": magento_db["host"],
        "host": endpoint["host"],
        "port": endpoint["port"],
        "name": magento_db.get("dbname"),
        "user": magento_db.get("username"),
        "hasPassword": bool(magento_db.get("password")),
        "connectVia": endpoint["via"],
        "dockerComposePath": compose_file,
        "dockerService": endpoint.get("dockerService"),
    }


def resolve_database_config(
    project_root: str,
    *,
    database_host: str | None = None,
    database_port: int | None = None,
    database_name: str | None = None,
    database_user: str | None = None,
    database_password: str | None = None,
    docker_compose_path: str | None = None,
) -> dict | None:
    magento_db = read_magento_db_config(project_root) if project_root else None
    base_host = (database_host or (magento_db or {}).get("host") or "localhost").strip()
    base_port = int(database_port or (magento_db or {}).get("port") or 3306)
    name = database_name or (magento_db or {}).get("dbname")
    user = database_user or (magento_db or {}).get("username")
    password = database_password
    if password is None and magento_db:
        password = magento_db.get("password")

    if not name and not user:
        return None

    from services.docker_db import host_is_docker_internal

    if database_host and not host_is_docker_internal(database_host):
        endpoint = {
            "host": database_host.strip(),
            "port": int(database_port or base_port),
            "via": "manual host override",
            "dockerService": None,
            "composeFile": find_docker_compose_file(project_root or "", docker_compose_path),
        }
    else:
        endpoint = resolve_db_connect_endpoint(
            host=base_host,
            port=base_port,
            project_root=project_root,
            docker_compose_path=docker_compose_path,
            port_override=database_port,
        )

    return {
        "host": endpoint["host"],
        "port": endpoint["port"],
        "name": name,
        "user": user,
        "password": password or "",
        "magentoHost": (magento_db or {}).get("host"),
        "connectVia": endpoint["via"],
        "dockerService": endpoint.get("dockerService"),
        "composeFile": endpoint.get("composeFile"),
        "dockerComposePath": docker_compose_path,
    }


def check_database_connection(
    db_config: dict | None,
    *,
    project_root: str | None = None,
) -> dict:
    if not db_config:
        return {
            "key": "database",
            "label": "Database connection",
            "ok": True,
            "detail": "Skipped (no database credentials configured)",
        }

    name = db_config.get("name")
    user = db_config.get("user")
    if not name or not user:
        return {
            "key": "database",
            "label": "Database connection",
            "ok": False,
            "detail": "Database name and username are required",
        }

    host = db_config.get("host") or "localhost"
    port = int(db_config.get("port") or 3306)
    password = db_config.get("password") or ""
    connect_via = db_config.get("connectVia")
    compose_file = db_config.get("composeFile")
    docker_service = db_config.get("dockerService")

    detail_prefix = f"{user}@{host}:{port}/{name}"
    if connect_via and connect_via != "direct":
        detail_prefix = f"{detail_prefix} ({connect_via})"

    try:
        import pymysql

        conn = pymysql.connect(
            host=host,
            port=port,
            user=user,
            password=password,
            database=name,
            connect_timeout=5,
            read_timeout=5,
            write_timeout=5,
        )
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
        finally:
            conn.close()
        return {
            "key": "database",
            "label": "Database connection",
            "ok": True,
            "detail": detail_prefix,
        }
    except Exception as exc:
        last_error = str(exc)

    if compose_file and docker_service and project_root:
        docker_result = check_db_via_docker_exec(
            compose_file=compose_file,
            project_root=project_root,
            service=docker_service,
            user=user,
            password=password,
            database=name,
        )
        if docker_result["ok"]:
            return {
                "key": "database",
                "label": "Database connection",
                "ok": True,
                "detail": docker_result["detail"],
            }
        last_error = docker_result["detail"]

    magento_host = db_config.get("magentoHost")
    hints: list[str] = []
    if magento_host and magento_host != host:
        hints.append(
            f"Magento env.php uses host '{magento_host}' (Docker service name). "
            "CPWork maps that to localhost when docker-compose publishes port 3306."
        )
    if "Connection refused" in last_error or "111" in last_error:
        hints.append("Start the database container: docker-compose up -d db")
    if "name resolution" in last_error.lower():
        hints.append("Set Database host override to 127.0.0.1 or click Detect from project.")

    detail = last_error
    if hints:
        detail = f"{last_error} — {' '.join(hints)}"

    return {
        "key": "database",
        "label": "Database connection",
        "ok": False,
        "detail": detail,
    }


def resolve_environment(user_id: str, project_id: str) -> dict:
    project = projects_repo.find_by_id(project_id)
    if not project:
        raise HttpError.not_found("Project not found")

    env = environments_repo.find(user_id, project_id)
    if not env or not env.get("projectRoot"):
        raise HttpError(
            409,
            "Configure your local environment for this project first",
            "needs_local_setup",
            {"projectId": project_id, "suggestedDefaults": project["defaults"]},
        )

    if not os.path.exists(env["projectRoot"]):
        raise HttpError(
            409,
            f"Project path does not exist on this machine: {env['projectRoot']}",
            "path_not_found",
            {"projectId": project_id, "path": env["projectRoot"]},
        )

    return {
        "project": project,
        "env": env,
        "cwd": env["projectRoot"],
        "frontendUrl": env.get("frontendUrl") or project["defaults"].get("frontendUrl"),
        "backendUrl": env.get("backendUrl") or project["defaults"].get("backendUrl"),
    }


def check_environment_path(
    project_root: str,
    php_bin: str | None = None,
    db_config: dict | None = None,
) -> dict:
    import pathlib
    checks = []

    path_exists = bool(project_root) and os.path.exists(project_root)
    checks.append({
        "key": "path_exists",
        "label": "Project path exists",
        "ok": path_exists,
        "detail": project_root if path_exists else "Directory not found",
    })

    is_dir = False
    if path_exists:
        try:
            is_dir = os.path.isdir(project_root)
        except Exception:
            is_dir = False
    checks.append({"key": "is_directory", "label": "Path is a directory", "ok": is_dir})

    magento_bin = os.path.join(project_root, "bin", "magento") if path_exists else ""
    has_magento = bool(magento_bin) and os.path.exists(magento_bin)
    checks.append({
        "key": "magento_bin",
        "label": "Magento detected (bin/magento)",
        "ok": has_magento,
        "detail": "bin/magento found" if has_magento else "bin/magento not found",
    })

    git_dir = os.path.join(project_root, ".git") if path_exists else ""
    has_git = bool(git_dir) and os.path.exists(git_dir)
    checks.append({"key": "git_repo", "label": "Git repository present", "ok": has_git})

    composer_json = os.path.join(project_root, "composer.json") if path_exists else ""
    has_composer = bool(composer_json) and os.path.exists(composer_json)
    checks.append({"key": "composer", "label": "composer.json present", "ok": has_composer})

    phpunit = os.path.join(project_root, "vendor", "bin", "phpunit") if path_exists else ""
    has_phpunit = bool(phpunit) and os.path.exists(phpunit)
    checks.append({
        "key": "phpunit",
        "label": "PHPUnit available (vendor/bin/phpunit)",
        "ok": has_phpunit,
        "detail": None if has_phpunit else "Optional, needed for the test pipeline",
    })

    db_check = check_database_connection(db_config, project_root=project_root if path_exists else None)
    checks.append(db_check)

    required_keys = {"path_exists", "is_directory", "magento_bin", "git_repo"}
    if db_config and db_config.get("name"):
        required_keys.add("database")
    ok = all(c["ok"] for c in checks if c["key"] in required_keys)

    from database import now_iso
    return {"checkedAt": now_iso(), "ok": ok, "checks": checks}
