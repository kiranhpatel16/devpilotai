import os
import re
import pathlib
from lib.errors import HttpError

try:
    import git as gitlib
    GIT_AVAILABLE = True
except ImportError:
    GIT_AVAILABLE = False


def normalize_agent_path(cwd: str, path: str) -> str | None:
    """Map docker absolute paths (e.g. /var/www/html/...) to project-relative paths."""
    if not path:
        return None
    normalized = path.replace("\\", "/").strip()
    cwd_norm = os.path.normpath(cwd).replace("\\", "/").rstrip("/")
    if normalized.startswith(cwd_norm + "/"):
        return normalized[len(cwd_norm) + 1 :]
    docker_root = "/var/www/html"
    if normalized.startswith(docker_root + "/"):
        return normalized[len(docker_root) + 1 :]
    if normalized.startswith("/"):
        return None
    return normalized.lstrip("./")


def _safe_join(cwd: str, rel_path: str) -> str:
    rel_path = normalize_agent_path(cwd, rel_path) or rel_path
    if not rel_path or os.path.isabs(rel_path):
        raise HttpError.bad_request(f"Unsafe file path: {rel_path}")
    root = os.path.realpath(cwd)
    full = os.path.realpath(os.path.join(root, rel_path))
    if full != root and not full.startswith(root + os.sep):
        raise HttpError.bad_request(f"Unsafe file path escapes project root: {rel_path}")
    return full


def _read_if_exists(full: str) -> str:
    try:
        with open(full, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except Exception:
        return ""


def _looks_like_full_php_file(content: str) -> bool:
    text = (content or "").strip()
    if not text:
        return False
    if "<?php" in text:
        return True
    return "namespace " in text and ("class " in text or "interface " in text)


def _synthesize_content_from_edits(edits: list[dict]) -> str | None:
    if not edits:
        return None

    for edit in reversed(edits):
        new_str = edit.get("newString") or ""
        if _looks_like_full_php_file(new_str):
            return new_str

    content = ""
    for edit in edits:
        old_str = edit.get("oldString") or ""
        new_str = edit.get("newString") or ""
        if not old_str:
            content = new_str if not content else content + new_str
        elif content and old_str in content:
            if edit.get("replaceAll"):
                content = content.replace(old_str, new_str)
            else:
                content = content.replace(old_str, new_str, 1)

    if _looks_like_full_php_file(content):
        return content

    largest = max(((edit.get("newString") or "") for edit in edits), key=len, default="")
    if _looks_like_full_php_file(largest):
        return largest
    return None


def _convert_missing_modify_to_create(change: dict) -> dict | None:
    content = change.get("content")
    if isinstance(content, str) and content.strip():
        return {
            **change,
            "action": "create",
            "content": content,
            "edits": None,
        }

    edits = change.get("edits") or []
    synthesized = _synthesize_content_from_edits(edits)
    if synthesized:
        return {
            **change,
            "action": "create",
            "content": synthesized,
            "edits": None,
        }
    return None


def normalize_file_changes(cwd: str, files: list[dict]) -> list[dict]:
    """Fix common agent mistakes: modify on a path that does not exist yet → create."""
    normalized: list[dict] = []
    for change in files:
        action = change.get("action", "modify")
        raw_path = change.get("path") or ""
        path = normalize_agent_path(cwd, raw_path)
        if not path:
            continue
        change = {**change, "path": path}
        if action != "modify":
            normalized.append(change)
            continue

        full = _safe_join(cwd, path)
        if os.path.exists(full):
            normalized.append(change)
            continue

        converted = _convert_missing_modify_to_create(change)
        if converted:
            normalized.append(converted)
            continue

        normalized.append(change)
    return normalized


def repair_file_changes(cwd: str, files: list[dict]) -> list[dict]:
    """Auto-repair structural agent mistakes before validation."""
    repaired = normalize_file_changes(cwd, files)
    out: list[dict] = []
    for change in repaired:
        if change.get("action") != "modify":
            out.append(change)
            continue

        full = _safe_join(cwd, change["path"])
        if os.path.exists(full):
            out.append(change)
            continue

        converted = _convert_missing_modify_to_create(change)
        out.append(converted if converted else change)
    return out


def merge_refined_files(
    prior_files: list[dict],
    new_files: list[dict],
    *,
    broken_paths: set[str] | None = None,
) -> list[dict]:
    """When refine returns a partial proposal, keep prior files the agent omitted.

    If broken_paths is set, do not resurrect prior versions of files that still
    had validation errors — the agent must return corrected versions explicitly.
    """
    if not prior_files:
        return list(new_files)
    if len(new_files) >= len(prior_files):
        return list(new_files)

    broken = {p.replace("\\", "/") for p in (broken_paths or set())}
    new_by_path = {f["path"]: f for f in new_files if f.get("path")}
    merged = list(new_files)
    for prior in prior_files:
        path = prior.get("path")
        if not path or path in new_by_path:
            continue
        if path in broken:
            continue
        merged.append(prior)
    return merged


def resolve_new_content(cwd: str, change: dict) -> dict:
    action = change.get("action", "modify")
    if action == "delete":
        return {"content": None, "error": None}
    if action == "create":
        return {"content": change.get("content") or "", "error": None}

    # modify
    full = _safe_join(cwd, change["path"])
    exists = os.path.exists(full)
    edits = change.get("edits") or []

    if edits:
        if not exists:
            return {"content": None, "error": f"Cannot apply edits: file does not exist ({change['path']})"}
        content = _read_if_exists(full)
        for i, edit in enumerate(edits):
            old_str = edit.get("oldString", "")
            new_str = edit.get("newString", "")
            if old_str == "":
                return {"content": None, "error": f"Edit {i+1}: empty oldString is not allowed"}
            if old_str not in content:
                return {"content": None, "error": f"Edit {i+1}: could not find the text to replace in {change['path']}. The file was left unchanged."}
            if edit.get("replaceAll"):
                content = content.replace(old_str, new_str)
            else:
                content = content.replace(old_str, new_str, 1)
        return {"content": content, "error": None}

    if change.get("content") is not None:
        return {"content": change["content"], "error": None}

    return {"content": None, "error": f"No edits or content provided for {change['path']}"}


def compute_diffs(cwd: str, files: list[dict]) -> list[dict]:
    import difflib
    diffs = []
    for f in files:
        full = _safe_join(cwd, f["path"])
        current = "" if f["action"] == "create" else _read_if_exists(full)
        resolved = resolve_new_content(cwd, f)
        if resolved["error"]:
            diffs.append({"path": f["path"], "action": f["action"], "reason": f.get("reason"),
                          "patch": "", "added": 0, "removed": 0, "error": resolved["error"]})
            continue
        proposed = resolved["content"] or ""
        patch_lines = list(difflib.unified_diff(
            current.splitlines(keepends=True),
            proposed.splitlines(keepends=True),
            fromfile=f"a/{f['path']}", tofile=f"b/{f['path']}",
        ))
        patch = "".join(patch_lines)
        added = sum(1 for l in patch_lines if l.startswith("+") and not l.startswith("+++"))
        removed = sum(1 for l in patch_lines if l.startswith("-") and not l.startswith("---"))
        diffs.append({"path": f["path"], "action": f["action"], "reason": f.get("reason"),
                      "patch": patch, "added": added, "removed": removed, "error": None})
    return diffs


def _resolve_base_ref(repo, base_branch: str) -> str:
    for ref in (f"origin/{base_branch}", base_branch):
        try:
            repo.git.rev_parse("--verify", ref)
            return ref
        except Exception:
            pass
    return base_branch


def _parse_name_status(output: str) -> list[dict]:
    files: list[dict] = []
    for line in (output or "").strip().splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) < 2:
            continue
        status = parts[0]
        if status.startswith("R") or status.startswith("C"):
            path = parts[2] if len(parts) > 2 else parts[1]
            action = "create" if status.startswith("C") else "modify"
        elif status == "A":
            path, action = parts[1], "create"
        elif status == "D":
            path, action = parts[1], "delete"
        else:
            path, action = parts[1], "modify"
        files.append({"path": path, "action": action})
    return files


def _count_patch_stats(patch: str) -> tuple[int, int]:
    added = sum(1 for line in patch.splitlines() if line.startswith("+") and not line.startswith("+++"))
    removed = sum(1 for line in patch.splitlines() if line.startswith("-") and not line.startswith("---"))
    return added, removed


def list_branch_file_changes(
    cwd: str,
    base_branch: str,
    branch: str | None = None,
    *,
    include_working_tree: bool = False,
) -> list[dict]:
    """Files on branch vs merge-base of base_branch (matches PR file list)."""
    if not GIT_AVAILABLE:
        return []
    try:
        repo = gitlib.Repo(cwd)
        base_ref = _resolve_base_ref(repo, base_branch)
        head = branch or repo.active_branch.name
        merged: dict[str, dict] = {}

        for item in _parse_name_status(repo.git.diff("--name-status", f"{base_ref}...{head}")):
            merged[item["path"]] = item

        if include_working_tree:
            for item in _parse_name_status(repo.git.diff("--name-status", "HEAD")):
                merged[item["path"]] = item
            for path in repo.untracked_files:
                merged[path] = {"path": path, "action": "create"}

        return sorted(merged.values(), key=lambda f: f["path"].lower())
    except Exception:
        return []


def compute_git_diffs(
    cwd: str,
    base_branch: str,
    branch: str | None,
    files: list[dict],
    *,
    include_working_tree: bool = False,
) -> list[dict]:
    """Unified diffs from git for branch file changes (for PR / post-commit display)."""
    if not GIT_AVAILABLE or not files:
        return []
    try:
        repo = gitlib.Repo(cwd)
        base_ref = _resolve_base_ref(repo, base_branch)
        head = branch or repo.active_branch.name
        diffs = []
        for f in files:
            path = f["path"]
            try:
                if include_working_tree:
                    patch = repo.git.diff("HEAD", "--", path)
                    if not patch and f.get("action") == "create":
                        full = _safe_join(cwd, path)
                        if os.path.isfile(full):
                            import difflib
                            content = _read_if_exists(full)
                            patch = "".join(difflib.unified_diff(
                                [],
                                content.splitlines(keepends=True),
                                fromfile=f"a/{path}",
                                tofile=f"b/{path}",
                            ))
                else:
                    patch = repo.git.diff(f"{base_ref}...{head}", "--", path)
            except Exception as err:
                diffs.append({
                    "path": path,
                    "action": f.get("action", "modify"),
                    "reason": f.get("reason"),
                    "patch": "",
                    "added": 0,
                    "removed": 0,
                    "error": str(err),
                })
                continue
            added, removed = _count_patch_stats(patch or "")
            diffs.append({
                "path": path,
                "action": f.get("action", "modify"),
                "reason": f.get("reason"),
                "patch": patch or "",
                "added": added,
                "removed": removed,
                "error": None,
            })
        return diffs
    except Exception:
        return []


def enrich_detail_files_from_git(
    run: dict,
    detail: dict,
    cwd: str,
    git_cfg: dict,
) -> dict:
    """Replace output.files / diffs with git branch truth after apply or commit."""
    git_info = detail.get("git") or {}
    if not run.get("branchName"):
        return detail
    if not detail.get("applied") and not git_info.get("committed"):
        return detail

    base_branch = (
        git_cfg.get("prTargetBranch")
        or git_cfg.get("stagingBranch")
        or git_cfg.get("productionBranch")
        or "main"
    )
    include_wt = bool(detail.get("applied") and not git_info.get("committed"))
    branch_files = list_branch_file_changes(
        cwd,
        base_branch,
        run["branchName"],
        include_working_tree=include_wt,
    )
    if not branch_files:
        return detail

    output = dict(detail.get("output") or {})
    reason_by_path = {
        f["path"]: f.get("reason")
        for f in (output.get("files") or [])
        if isinstance(f, dict) and f.get("path")
    }
    files = [
        {
            "path": bf["path"],
            "action": bf["action"],
            "reason": reason_by_path.get(bf["path"]),
        }
        for bf in branch_files
    ]
    diffs = compute_git_diffs(
        cwd,
        base_branch,
        run["branchName"],
        files,
        include_working_tree=include_wt,
    )
    return {
        **detail,
        "output": {**output, "files": files},
        "diffs": diffs,
    }


def capture_backups(cwd: str, files: list[dict], selected_paths: list[str] | None = None) -> list[dict]:
    backups = []
    for f in files:
        if selected_paths and f["path"] not in selected_paths:
            continue
        full = _safe_join(cwd, f["path"])
        existed = os.path.exists(full)
        backups.append({
            "path": f["path"],
            "existedBefore": existed,
            "previousContent": _read_if_exists(full) if existed else None,
        })
    return backups


def revert_changes(cwd: str, backups: list[dict]) -> list[str]:
    reverted = []
    for b in backups:
        full = _safe_join(cwd, b["path"])
        if b["existedBefore"]:
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf-8") as fp:
                fp.write(b["previousContent"] or "")
        elif os.path.exists(full):
            os.remove(full)
        reverted.append(b["path"])
    return reverted


def apply_changes(cwd: str, files: list[dict], selected_paths: list[str] | None = None) -> list[str]:
    selected = [f for f in files if not selected_paths or f["path"] in selected_paths]
    resolved_all = [{"change": f, **resolve_new_content(cwd, f)} for f in selected]
    failures = [r for r in resolved_all if r["error"]]
    if failures:
        msg = "; ".join(f"{r['change']['path']} — {r['error']}" for r in failures)
        raise HttpError(409, f"Could not apply {len(failures)} change(s): {msg}", "apply_edit_failed",
                        {"failures": [{"path": r["change"]["path"], "error": r["error"]} for r in failures]})

    applied = []
    for r in resolved_all:
        full = _safe_join(cwd, r["change"]["path"])
        if r["change"]["action"] == "delete":
            if os.path.exists(full):
                os.remove(full)
        else:
            os.makedirs(os.path.dirname(full), exist_ok=True)
            with open(full, "w", encoding="utf-8") as fp:
                fp.write(r["content"] or "")
        applied.append(r["change"]["path"])
    return applied


async def create_branch(cwd: str, branch: str, base_branch: str) -> dict:
    if not GIT_AVAILABLE:
        raise HttpError(500, "GitPython not installed", "git_unavailable")
    try:
        repo = gitlib.Repo(cwd)
    except Exception:
        raise HttpError(500, f"Not a git repository: {cwd}", "git_not_repo")

    try:
        repo.remotes.origin.fetch(base_branch)
    except Exception:
        try:
            repo.remotes.origin.fetch()
        except Exception:
            pass

    base_ref = base_branch
    try:
        repo.git.rev_parse("--verify", f"origin/{base_branch}")
        base_ref = f"origin/{base_branch}"
    except Exception:
        try:
            repo.git.rev_parse("--verify", base_branch)
        except Exception:
            base_ref = "HEAD"

    local_branches = [b.name for b in repo.branches]
    branch_exists = branch in local_branches
    is_dirty = repo.is_dirty(index=True, working_tree=True, untracked_files=True)
    stashed = False

    def _autostash():
        nonlocal stashed
        if not is_dirty:
            return
        repo.git.stash("push", "-u", "-m", "CPWork: autostash before branch checkout")
        stashed = True

    try:
        if branch_exists:
            if repo.active_branch.name != branch:
                _autostash()
                repo.git.checkout(branch)
        else:
            _autostash()
            repo.git.checkout("-b", branch, base_ref)
    except Exception as e:
        if stashed:
            try:
                repo.git.stash("pop")
            except Exception:
                pass
        raise HttpError(
            500,
            f'Failed to create branch "{branch}" from {base_ref}',
            "git_branch_failed",
            {"cause": str(e), "baseRef": base_ref},
        )

    return {"branch": branch, "baseRef": base_ref, "stashed": stashed}


async def get_status(cwd: str, base_branch: str) -> dict:
    if not GIT_AVAILABLE:
        return {"branch": None, "baseBranch": base_branch, "ahead": 0, "behind": 0,
                "staged": 0, "changedFiles": [], "committed": False, "pushed": False,
                "commitMessage": None, "prUrl": None}
    try:
        repo = gitlib.Repo(cwd)
        current = repo.active_branch.name
        ahead, behind = 0, 0
        try:
            tracking = repo.active_branch.tracking_branch()
            if tracking:
                commits_ahead = list(repo.iter_commits(f"{tracking}..HEAD"))
                commits_behind = list(repo.iter_commits(f"HEAD..{tracking}"))
                ahead = len(commits_ahead)
                behind = len(commits_behind)
        except Exception:
            pass
        changed = [item.a_path for item in repo.index.diff(None)] + repo.untracked_files
        staged = len(repo.index.diff("HEAD"))
        return {
            "branch": current,
            "baseBranch": base_branch,
            "ahead": ahead,
            "behind": behind,
            "staged": staged,
            "changedFiles": changed,
            "committed": False,
            "pushed": False,
            "commitMessage": None,
            "prUrl": None,
        }
    except Exception:
        return {"branch": None, "baseBranch": base_branch, "ahead": 0, "behind": 0,
                "staged": 0, "changedFiles": [], "committed": False, "pushed": False,
                "commitMessage": None, "prUrl": None}


async def commit_all(cwd: str, message: str) -> str:
    if not GIT_AVAILABLE:
        raise HttpError(500, "GitPython not installed", "git_unavailable")
    repo = gitlib.Repo(cwd)
    repo.git.add("-A")
    result = repo.index.commit(message)
    return result.hexsha


async def get_recent_commits(cwd: str, branch: str | None = None, limit: int = 10) -> list[dict]:
    if not GIT_AVAILABLE:
        return []
    from datetime import datetime, timezone
    try:
        repo = gitlib.Repo(cwd)
        ref = branch or (repo.active_branch.name if not repo.head.is_detached else "HEAD")
        commits = []
        for c in repo.iter_commits(ref, max_count=limit):
            committed = datetime.fromtimestamp(c.committed_date, tz=timezone.utc)
            commits.append({
                "hash": c.hexsha[:7],
                "fullHash": c.hexsha,
                "message": c.summary,
                "author": c.author.name if c.author else None,
                "when": committed.isoformat(),
                "added": c.stats.total.get("insertions", 0) if c.stats else 0,
                "removed": c.stats.total.get("deletions", 0) if c.stats else 0,
            })
        return commits
    except Exception:
        return []


async def push_branch(cwd: str, branch: str, remote: str = "origin") -> None:
    if not GIT_AVAILABLE:
        raise HttpError(500, "GitPython not installed", "git_unavailable")
    try:
        repo = gitlib.Repo(cwd)
        repo.git.push("-u", remote, branch)
    except Exception as e:
        raise HttpError(500, f"Failed to push branch \"{branch}\"", "git_push_failed", {"cause": str(e)})
