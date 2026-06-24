import os
import re
import pathlib
from lib.errors import HttpError

try:
    import git as gitlib
    GIT_AVAILABLE = True
except ImportError:
    GIT_AVAILABLE = False


def _safe_join(cwd: str, rel_path: str) -> str:
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
