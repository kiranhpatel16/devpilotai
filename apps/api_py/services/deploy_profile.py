"""Resolve Magento deploy profile from changed files and project settings."""

from __future__ import annotations

from typing import Literal

DeployProfile = Literal["light", "standard", "full"]
DeployProfileMode = DeployProfile | Literal["auto"]

DEPLOY_STEP_LABELS: dict[str, str] = {
    "docker_target": "Docker target",
    "composer_install": "Composer install",
    "clear_generated": "Clear static/cache/generated",
    "setup_upgrade": "setup:upgrade",
    "di_compile": "setup:di:compile",
    "static_deploy": "setup:static-content:deploy",
    "cache_clean": "cache:clean",
    "cache_flush": "cache:flush",
    "chmod_permissions": "chmod permissions",
}


def _norm(path: str) -> str:
    return path.replace("\\", "/").lower()


def _is_light_path(path: str) -> bool:
    p = _norm(path)
    if p.endswith((".phtml", ".html")):
        return True
    if p.endswith((".css", ".js", ".less")):
        return True
    if "/layout/" in p and p.endswith(".xml"):
        return True
    if "/templates/" in p and p.endswith(".xml"):
        return True
    return False


def _needs_full_deploy(paths: list[str]) -> bool:
    for raw in paths:
        p = _norm(raw)
        if p.endswith(("composer.json", "composer.lock")):
            return True
        if p.endswith("module.xml") or "/etc/module.xml" in p:
            return True
        if "/setup/" in p:
            return True
        if p.endswith(".php") and ("/registration.php" in p or p.endswith("/registration.php")):
            return True
    return False


def _needs_standard_deploy(paths: list[str]) -> bool:
    for raw in paths:
        p = _norm(raw)
        if p.endswith(".php"):
            return True
        if p.endswith("di.xml") or "/etc/di.xml" in p:
            return True
        if "/etc/" in p and p.endswith(".xml"):
            return True
        if "/view/frontend/" in p and p.endswith(".xml") and "/layout/" not in p:
            return True
    return False


def _needs_static_deploy(paths: list[str]) -> bool:
    for raw in paths:
        p = _norm(raw)
        if p.endswith(".less") or p.endswith(".css"):
            return True
        if "/web/css/" in p or "/web/js/" in p:
            return True
    return False


def classify_deploy_profile(changed_paths: list[str]) -> DeployProfile:
    paths = [p for p in changed_paths if p]
    if not paths:
        return "light"
    if _needs_full_deploy(paths):
        return "full"
    if _needs_standard_deploy(paths):
        return "standard"
    if all(_is_light_path(p) for p in paths):
        return "light"
    return "standard"


def resolve_deploy_profile(
    changed_paths: list[str],
    project_mode: DeployProfileMode = "auto",
) -> DeployProfile:
    if project_mode != "auto":
        return project_mode  # type: ignore[return-value]
    return classify_deploy_profile(changed_paths)


def should_run_composer_install(
    profile: DeployProfile,
    changed_paths: list[str],
    skip_composer_project: bool = False,
) -> bool:
    if skip_composer_project:
        return False
    if profile == "light":
        return False
    return any(
        _norm(p).endswith(("composer.json", "composer.lock")) for p in changed_paths
    )


def should_run_setup_upgrade(profile: DeployProfile, changed_paths: list[str]) -> bool:
    return profile == "full" and _needs_full_deploy(changed_paths)


def should_run_di_compile(profile: DeployProfile) -> bool:
    return profile in ("standard", "full")


def should_run_static_deploy(profile: DeployProfile, changed_paths: list[str]) -> bool:
    if profile == "full":
        return True
    return _needs_static_deploy(changed_paths)


def deploy_profile_reason(profile: DeployProfile, changed_paths: list[str]) -> str:
    names = [(p.split("/")[-1] or p) for p in changed_paths[:4]]
    suffix = f" +{len(changed_paths) - 4} more" if len(changed_paths) > 4 else ""
    files = f"{', '.join(names)}{suffix}" if names else "no file list"
    if profile == "light":
        return f"Template/layout-only changes ({files}) — cache flush is enough."
    if profile == "standard":
        return f"PHP or config XML changed ({files}) — DI compile required."
    return f"Composer or module setup changed ({files}) — full Magento deploy."
