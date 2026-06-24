from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from middleware.auth import get_auth
from db.runs import runs_repo
from services.agents.registry import AGENT_REGISTRY

router = APIRouter(prefix="/api/agents", tags=["agents"])


@router.get("/status")
async def agent_status(auth: dict = Depends(get_auth)):
    active_runs = runs_repo.list_for_user(auth["sub"], limit=20)
    busy_agents: dict[str, str] = {}
    for run in active_runs:
        if run.get("status") in ("analyzing", "branching", "awaiting_review", "testing"):
            step = run.get("currentStep") or "agent"
            from services.agents.registry import agent_for_step
            aid = agent_for_step(step) or "developer"
            busy_agents[aid] = run.get("jiraKey") or run.get("summary") or run["id"]

    agents = []
    for agent_id, cfg in AGENT_REGISTRY.items():
        task = busy_agents.get(agent_id)
        agents.append({
            "id": agent_id,
            "label": cfg["label"],
            "status": "busy" if task else "online",
            "task": task,
        })
    return {"agents": agents}
