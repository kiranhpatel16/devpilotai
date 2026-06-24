import base64
import httpx
from lib.errors import HttpError
from lib.crypto import decrypt_secret
from db.projects import projects_repo


def _auth_header(creds: dict) -> str:
    token = base64.b64encode(f"{creds['email']}:{creds['apiToken']}".encode()).decode()
    return f"Basic {token}"


def _base(creds: dict) -> str:
    return creds["baseUrl"].rstrip("/")


async def _request(creds: dict, path: str, method: str = "GET", body: dict | None = None) -> dict:
    url = f"{_base(creds)}{path}"
    headers = {
        "Authorization": _auth_header(creds),
        "Accept": "application/json",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            if method == "POST":
                resp = await client.post(url, json=body, headers=headers)
            else:
                resp = await client.get(url, headers=headers)
    except Exception as e:
        raise HttpError(502, f"Could not reach Jira at {creds['baseUrl']}", "jira_unreachable", {"cause": str(e)})

    if resp.status_code in (401, 403):
        raise HttpError(502, "Jira authentication failed. Check email and API token.", "jira_auth_failed")
    if not resp.is_success:
        raise HttpError(502, f"Jira request failed ({resp.status_code})", "jira_error",
                        {"status": resp.status_code, "body": resp.text[:500]})
    return resp.json()


def _adf_to_text(adf) -> str:
    if not adf or not isinstance(adf, dict):
        return str(adf) if isinstance(adf, str) else ""
    lines = []

    def walk(node, list_prefix=""):
        if not node:
            return
        t = node.get("type", "")
        if t == "text":
            lines.append(node.get("text", ""))
            return
        if t == "hardBreak":
            lines.append("\n")
            return
        if t == "mention":
            attrs = node.get("attrs", {})
            lines.append(f"@{attrs.get('text', attrs.get('id', ''))}")
            return
        children = node.get("content", []) or []
        if t in ("bulletList", "orderedList"):
            for idx, item in enumerate(children):
                prefix = f"{idx + 1}. " if t == "orderedList" else "- "
                walk(item, prefix)
            return
        if t == "listItem":
            lines.append(f"\n{list_prefix}")
            for c in children:
                walk(c, list_prefix)
            return
        for c in children:
            walk(c, list_prefix)
        if t in ("paragraph", "heading", "codeBlock", "blockquote"):
            lines.append("\n")

    walk(adf)
    import re
    return re.sub(r"\n{3,}", "\n\n", "".join(lines)).strip()


ISSUE_FIELDS = ["summary", "status", "assignee", "priority", "issuetype", "updated"]
DETAIL_FIELDS = ISSUE_FIELDS + ["description", "attachment", "labels", "components"]


def _jira_str(value) -> str | None:
    return value if isinstance(value, str) and value else None


def _map_task(base_url: str, issue: dict) -> dict:
    f = issue.get("fields") or {}
    status = f.get("status") or {}
    assignee = f.get("assignee") or None
    priority = f.get("priority") or None
    issuetype = f.get("issuetype") or None
    return {
        "key": issue["key"],
        "summary": _jira_str(f.get("summary")) or "(no summary)",
        "status": _jira_str(status.get("name")) or "Unknown",
        "statusCategory": _jira_str((status.get("statusCategory") or {}).get("name")) or "Unknown",
        "assignee": _jira_str(assignee.get("displayName")) if assignee else None,
        "assigneeEmail": _jira_str(assignee.get("emailAddress")) if assignee else None,
        "priority": _jira_str(priority.get("name")) if priority else None,
        "issueType": _jira_str(issuetype.get("name")) if issuetype else None,
        "updated": _jira_str(f.get("updated")),
        "url": f"{base_url.rstrip('/')}/browse/{issue['key']}",
    }


def resolve_jira(project_id: str, overrides: dict | None = None) -> dict | None:
    project = projects_repo.find_by_id(project_id)
    if not project:
        raise HttpError.not_found("Project not found")

    overrides = overrides or {}
    base_url = (overrides.get("baseUrl") or project["jira"]["baseUrl"] or "").strip() or None
    email = (overrides.get("email") or project["jira"]["email"] or "").strip() or None

    api_token = overrides.get("apiToken")
    if not api_token:
        token_enc = projects_repo.get_jira_token_enc(project_id)
        if token_enc:
            api_token = decrypt_secret(token_enc)

    if not base_url or not email or not api_token:
        return None
    return {
        "project": project,
        "creds": {
            "baseUrl": base_url,
            "email": email,
            "apiToken": api_token,
        },
    }


def _quote(value: str) -> str:
    return '"' + value.replace('"', '\\"') + '"'


def build_jql(project: dict, options: dict = {}) -> str:
    clauses = []
    if project["jira"]["projectKey"]:
        clauses.append(f"project = {_quote(project['jira']['projectKey'])}")
    statuses = [s for s in (project["jira"].get("statusFilters") or []) if s]
    if statuses:
        clauses.append(f"status IN ({', '.join(_quote(s) for s in statuses)})")
    assignee = (options.get("assigneeValue") or "").strip()
    if assignee:
        is_func = assignee.endswith(")")
        clauses.append(f"assignee = {assignee if is_func else _quote(assignee)}")
    where = " AND ".join(clauses)
    return f"{where} ORDER BY updated DESC" if where else "ORDER BY updated DESC"


def _resolve_status_label(configured: list[str], task_status: str) -> str:
    """Map a Jira task status onto a configured filter label (case-insensitive)."""
    task_lower = (task_status or "").strip().lower()
    for label in configured:
        if label.strip().lower() == task_lower:
            return label
    return task_status


async def get_board(project_id: str, options: dict = {}) -> dict:
    resolved = resolve_jira(project_id)
    if not resolved:
        return {
            "configured": False,
            "projectKey": None,
            "message": "Jira is not configured for this project. Ask an admin to add credentials.",
            "groups": [],
            "total": 0,
        }

    project = resolved["project"]
    creds = resolved["creds"]
    jql = build_jql(project, options)
    data = await _request(creds, "/rest/api/3/search/jql", "POST",
                          {"jql": jql, "maxResults": 100, "fields": ISSUE_FIELDS})
    issues = data.get("issues") or []
    tasks = [_map_task(creds["baseUrl"], i) for i in issues]

    order = [s for s in (project["jira"].get("statusFilters") or []) if s]
    group_map: dict[str, list] = {s: [] for s in order}
    for task in tasks:
        label = _resolve_status_label(order, task["status"])
        if label not in group_map:
            group_map[label] = []
        group_map[label].append(task)

    groups = [{"status": status, "tasks": group_map[status]} for status in order]
    for status, task_list in group_map.items():
        if status not in order:
            groups.append({"status": status, "tasks": task_list})
    return {
        "configured": True,
        "projectKey": project["jira"]["projectKey"],
        "groups": groups,
        "total": len(tasks),
    }


async def get_issue_detail(project_id: str, key: str) -> dict:
    resolved = resolve_jira(project_id)
    if not resolved:
        raise HttpError(409, "Jira is not configured for this project", "jira_not_configured")
    creds = resolved["creds"]
    fields = ",".join(DETAIL_FIELDS)
    issue = await _request(creds, f"/rest/api/3/issue/{key}?fields={fields}")
    base = _map_task(creds["baseUrl"], issue)
    f = issue.get("fields") or {}
    labels = f.get("labels") if isinstance(f.get("labels"), list) else []
    components = [c.get("name", "") for c in (f.get("components") or []) if c.get("name")]
    attachments = []
    for a in (f.get("attachment") or []):
        if not isinstance(a, dict):
            continue
        mime = _jira_str(a.get("mimeType"))
        attachments.append({
            "id": str(a.get("id", "")),
            "filename": _jira_str(a.get("filename")) or "attachment",
            "mimeType": mime,
            "size": a.get("size") if isinstance(a.get("size"), int) else None,
            "url": _jira_str(a.get("content")) or "",
            "isImage": bool(mime and mime.startswith("image/")),
        })
    return {**base, "description": _adf_to_text(f.get("description")),
            "labels": labels, "components": components, "attachments": attachments}


async def test_connection(creds: dict) -> dict:
    return await _request(creds, "/rest/api/3/myself")


async def lookup_user_account_id(creds: dict, query: str) -> dict | None:
    """Find a Jira Cloud user by email or display name; returns accountId + displayName."""
    q = query.strip()
    if not q:
        return None
    from urllib.parse import quote
    data = await _request(creds, f"/rest/api/3/user/search?query={quote(q)}&maxResults=10")
    users = data if isinstance(data, list) else data.get("values") or []
    q_lower = q.lower()
    for user in users:
        if not isinstance(user, dict):
            continue
        account_id = user.get("accountId")
        if not account_id:
            continue
        email = (user.get("emailAddress") or "").lower()
        name = (user.get("displayName") or "").lower()
        if email == q_lower or name == q_lower or q_lower in email:
            return {
                "accountId": account_id,
                "displayName": user.get("displayName"),
                "emailAddress": user.get("emailAddress"),
            }
    if users and isinstance(users[0], dict) and users[0].get("accountId"):
        u = users[0]
        return {
            "accountId": u.get("accountId"),
            "displayName": u.get("displayName"),
            "emailAddress": u.get("emailAddress"),
        }
    return None


async def post_issue_comment(project_id: str, issue_key: str, body: str) -> dict:
    resolved = resolve_jira(project_id)
    if not resolved:
        raise HttpError(409, "Jira is not configured for this project", "jira_not_configured")
    creds = resolved["creds"]
    payload = {"body": {"type": "doc", "version": 1, "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": line}]}
        for line in body.split("\n") if line.strip()
    ] or [{"type": "paragraph", "content": [{"type": "text", "text": body}]}]}}
    return await _request(
        creds,
        f"/rest/api/3/issue/{issue_key}/comment",
        "POST",
        payload,
    )
