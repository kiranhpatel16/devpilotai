from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional, Literal
from middleware.auth import get_auth
from db.project_roles import project_roles_repo
from lib.errors import HttpError
from services.environment import resolve_environment
from services.ai_service import run_ai
from services.repo_context import build_repo_context
from services.ai_providers.registry import enabled_provider_info
from db.knowledge import knowledge_repo, project_memory_repo
from middleware.auth import is_admin_role

router = APIRouter(prefix="/api/projects", tags=["chat"])


class ChatBody(BaseModel):
    message: str
    mode: Literal["ask", "find_files", "explain_change", "generate_test"] = "ask"


def _assert_access(auth: dict, project_id: str):
    if is_admin_role(auth["role"]):
        return
    if not project_roles_repo.get_role(auth["sub"], project_id):
        raise HttpError.forbidden("You are not assigned to this project")


def _pick_provider() -> str:
    enabled = enabled_provider_info()
    if not enabled:
        raise HttpError.bad_request("No AI provider enabled")
    return enabled[0]["id"]


@router.post("/{project_id}/chat")
async def project_chat(project_id: str, body: ChatBody, auth: dict = Depends(get_auth)):
    _assert_access(auth, project_id)
    resolved = resolve_environment(auth["sub"], project_id)
    knowledge = knowledge_repo.search(project_id, body.message, limit=3)
    memory = project_memory_repo.get_context(project_id)
    repo = build_repo_context(resolved["cwd"], body.message, resolved["project"].get("frontendTheme"))

    mode_map = {
        "ask": "ask",
        "find_files": "ask",
        "explain_change": "ask",
        "generate_test": "plan",
    }
    instructions = body.message
    if body.mode == "find_files":
        instructions = f"List files likely related to: {body.message}"
    elif body.mode == "generate_test":
        instructions = f"Generate unit test plan for: {body.message}"

    ctx = {
        "mode": mode_map[body.mode],
        "project": resolved["project"],
        "cwd": resolved["cwd"],
        "userInstructions": instructions + "\n\n" + memory,
        "repoOverview": repo["overview"],
        "fileExcerpts": repo["excerpts"],
        "knowledgeChunks": [f"{k['title']}: {k['content'][:500]}" for k in knowledge],
    }
    provider = _pick_provider()
    result = await run_ai(provider, None, ctx)
    output = result["output"]
    return {
        "answer": output.get("summary") or output.get("text") or "",
        "files": [f.get("path") for f in (output.get("files") or [])],
        "citations": [k["title"] for k in knowledge],
    }


class IncidentBody(BaseModel):
    logs: str
    reportId: Optional[str] = None


@router.post("/{project_id}/incidents/analyze")
async def analyze_incident(project_id: str, body: IncidentBody, auth: dict = Depends(get_auth)):
    _assert_access(auth, project_id)
    resolved = resolve_environment(auth["sub"], project_id)
    provider = _pick_provider()
    ctx = {
        "mode": "debug",
        "project": resolved["project"],
        "cwd": resolved["cwd"],
        "userInstructions": (
            f"Production incident analysis.\nReport ID: {body.reportId or 'N/A'}\n\nLogs:\n{body.logs[:8000]}\n\n"
            "Provide: rootCause, suggestedFix, filesToUpdate (array), riskAssessment"
        ),
        "repoOverview": build_repo_context(resolved["cwd"], body.logs[:500], None)["overview"],
        "fileExcerpts": [],
    }
    result = await run_ai(provider, None, ctx)
    output = result["output"]
    return {
        "rootCause": output.get("summary") or "See analysis below",
        "analysis": output.get("text") or output.get("summary") or "",
        "suggestedFix": (output.get("risks") or [{}])[0].get("mitigation") if output.get("risks") else None,
        "files": [f.get("path") for f in (output.get("files") or [])],
    }
