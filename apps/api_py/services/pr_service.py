import base64
import re
import subprocess
import httpx
from lib.errors import HttpError
from lib.crypto import decrypt_secret
from db.projects import projects_repo

try:
    import git as gitlib
    GIT_AVAILABLE = True
except ImportError:
    GIT_AVAILABLE = False


def _parse_git_remote(url: str) -> dict | None:
    if not url:
        return None
    url = url.strip()
    ssh = re.match(r"git@([^:]+):([^/]+)/(.+?)(?:\.git)?$", url)
    if ssh:
        host, owner, name = ssh.group(1), ssh.group(2), ssh.group(3)
        provider = "bitbucket" if "bitbucket" in host else "github"
        return {"provider": provider, "owner": owner, "name": name, "host": host}
    https = re.match(r"https?://([^/]+)/([^/]+)/([^/]+?)(?:\.git)?/?$", url)
    if https:
        host, owner, name = https.group(1), https.group(2), https.group(3)
        provider = "bitbucket" if "bitbucket" in host else "github"
        return {"provider": provider, "owner": owner, "name": name, "host": host}
    return None


def _detect_remote_repo(cwd: str, remote_name: str = "origin") -> dict | None:
    if not GIT_AVAILABLE:
        return None
    try:
        repo = gitlib.Repo(cwd)
        remote = repo.remotes[remote_name]
        return _parse_git_remote(remote.url)
    except Exception:
        return None


def resolve_pr_config(project_id: str, cwd: str, overrides: dict | None = None) -> dict:
    project = projects_repo.find_by_id(project_id)
    if not project:
        raise HttpError.not_found("Project not found")

    overrides = overrides or {}
    git_cfg = project["git"]
    token_enc = projects_repo.get_git_token_enc(project_id)
    token = decrypt_secret(token_enc) if token_enc else None
    if overrides.get("apiToken"):
        token = overrides["apiToken"]

    username = (overrides.get("apiUsername") or git_cfg.get("apiUsername") or "").strip() or None

    provider = (overrides.get("prProvider") or git_cfg.get("prProvider") or "").strip().lower() or None
    owner = (overrides.get("repoOwner") or git_cfg.get("repoOwner") or "").strip() or None
    name = (overrides.get("repoName") or git_cfg.get("repoName") or "").strip() or None

    detected = _detect_remote_repo(cwd, git_cfg.get("remote") or "origin")
    if detected:
        provider = provider or detected["provider"]
        owner = owner or detected["owner"]
        name = name or detected["name"]

    if not provider or not owner or not name:
        raise HttpError(
            409,
            "Git hosting is not fully configured. Set PR provider, repository owner (workspace), and repository name — or click Detect from git remote.",
            "pr_not_configured",
            {
                "hint": "For Fabric, workspace is likely cp-jira (from bitbucket.org/cp-jira/fabric5anddime_m2).",
                "detected": detected,
            },
        )

    if provider not in ("github", "bitbucket"):
        raise HttpError.bad_request(f"Unsupported PR provider: {provider}")

    if not token:
        label = "App Password" if provider == "bitbucket" else "Personal Access Token"
        raise HttpError(
            409,
            f"No {label} saved. Paste your Bitbucket App Password and click Save, then Test Git / PR.",
            "pr_token_missing",
            {"provider": provider},
        )

    if provider == "bitbucket" and not username:
        raise HttpError(
            409,
            "Bitbucket requires your Bitbucket username (not email) in project settings.",
            "pr_username_missing",
        )

    return {
        "provider": provider,
        "owner": owner,
        "name": name,
        "token": token,
        "username": username,
    }


def _bitbucket_auth_error(status: int, body: str) -> HttpError:
    if status == 401:
        return HttpError(
            502,
            "Bitbucket authentication failed. Use your Bitbucket username (not email) and an App Password — not your login password.",
            "pr_auth_failed",
            {"body": body[:300]},
        )
    if status == 403:
        return HttpError(
            502,
            "Bitbucket access denied. Ensure the App Password has Repository: Read and Pull requests: Write.",
            "pr_auth_failed",
            {"body": body[:300]},
        )
    if status == 404:
        return HttpError(
            502,
            "Bitbucket repository not found. Check workspace (owner) and repository name.",
            "pr_api_error",
            {"body": body[:300]},
        )
    return HttpError(502, f"Bitbucket API error ({status})", "pr_api_error", {"body": body[:300]})


async def test_git_connection(project_id: str, cwd: str | None = None, overrides: dict | None = None) -> dict:
    cfg = resolve_pr_config(project_id, cwd or ".", overrides)
    if cfg["provider"] == "bitbucket":
        url = f"https://api.bitbucket.org/2.0/repositories/{cfg['owner']}/{cfg['name']}"
        auth = (cfg["username"], cfg["token"])
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url, auth=auth)
        if not resp.is_success:
            raise _bitbucket_auth_error(resp.status_code, resp.text)
        data = resp.json()
        return {
            "provider": "bitbucket",
            "fullName": data.get("full_name"),
            "name": data.get("name"),
            "owner": cfg["owner"],
        }

    url = f"https://api.github.com/repos/{cfg['owner']}/{cfg['name']}"
    headers = {
        "Authorization": f"Bearer {cfg['token']}",
        "Accept": "application/vnd.github+json",
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(url, headers=headers)
    if resp.status_code in (401, 403):
        raise HttpError(502, "GitHub authentication failed", "pr_auth_failed")
    if not resp.is_success:
        raise HttpError(502, f"GitHub API error ({resp.status_code})", "pr_api_error",
                        {"body": resp.text[:300]})
    data = resp.json()
    return {"provider": "github", "fullName": data.get("full_name"), "name": data.get("name")}


async def _create_bitbucket_pr(cfg: dict, base: str, head: str, title: str, body: str) -> str:
    url = f"https://api.bitbucket.org/2.0/repositories/{cfg['owner']}/{cfg['name']}/pullrequests"
    payload = {
        "title": title,
        "description": body,
        "source": {"branch": {"name": head}},
        "destination": {"branch": {"name": base}},
        "close_source_branch": False,
    }
    auth = (cfg["username"], cfg["token"])
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, json=payload, auth=auth)
    if resp.status_code in (401, 403):
        raise _bitbucket_auth_error(resp.status_code, resp.text)
    if not resp.is_success:
        raise HttpError(502, "Bitbucket PR creation failed", "pr_api_error",
                        {"status": resp.status_code, "body": resp.text[:800]})
    data = resp.json()
    links = data.get("links") or {}
    html = (links.get("html") or {}).get("href")
    if html:
        return html
    return f"https://bitbucket.org/{cfg['owner']}/{cfg['name']}/pull-requests/{data.get('id')}"


async def _create_github_pr(cfg: dict, base: str, head: str, title: str, body: str) -> str:
    url = f"https://api.github.com/repos/{cfg['owner']}/{cfg['name']}/pulls"
    headers = {
        "Authorization": f"Bearer {cfg['token']}",
        "Accept": "application/vnd.github+json",
    }
    payload = {"title": title, "body": body, "head": head, "base": base}
    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(url, json=payload, headers=headers)
    if resp.status_code in (401, 403):
        raise HttpError(502, "GitHub authentication failed when creating PR", "pr_auth_failed")
    if not resp.is_success:
        raise HttpError(502, "GitHub PR creation failed", "pr_api_error",
                        {"status": resp.status_code, "body": resp.text[:800]})
    data = resp.json()
    return data.get("html_url") or data.get("url", "")


async def _gh_available() -> bool:
    try:
        result = subprocess.run(["gh", "--version"], capture_output=True, timeout=5)
        return result.returncode == 0
    except Exception:
        return False


async def _create_pr_via_gh(cwd: str, base: str, head: str, title: str, body: str) -> str:
    result = subprocess.run(
        ["gh", "pr", "create", "--base", base, "--head", head, "--title", title, "--body", body],
        cwd=cwd, capture_output=True, text=True, timeout=60,
    )
    if result.returncode != 0:
        output = (result.stdout + result.stderr)[:1000]
        raise HttpError(502, "gh pr create failed", "gh_pr_failed", {"output": output})
    output_lines = (result.stdout or "").strip().splitlines()
    url = next((l for l in output_lines if l.startswith("http")), None)
    return url or result.stdout.strip()


async def create_pull_request(
    project_id: str,
    cwd: str,
    base: str,
    head: str,
    title: str,
    body: str,
) -> str:
    try:
        cfg = resolve_pr_config(project_id, cwd)
    except HttpError as err:
        if err.code not in ("pr_not_configured", "pr_token_missing", "pr_username_missing"):
            raise
        if await _gh_available():
            return await _create_pr_via_gh(cwd, base, head, title, body)
        raise HttpError(
            503,
            f"{err.message} Alternatively install GitHub CLI (`gh`) on the server.",
            err.code or "pr_not_configured",
            {"base": base, "head": head, "title": title},
        )

    if cfg["provider"] == "bitbucket":
        return await _create_bitbucket_pr(cfg, base, head, title, body)
    return await _create_github_pr(cfg, base, head, title, body)
