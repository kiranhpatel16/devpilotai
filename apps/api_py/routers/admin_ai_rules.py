from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from lib.errors import HttpError
from middleware.auth import require_admin
from db.projects import projects_repo
from db.project_ai_rules import project_ai_rules_repo
from db.activities import activities_repo
from services.ai_rules import get_default_rules, resolve_effective_rules, get_editable_magento_template

router = APIRouter(prefix="/api/admin/ai-rules", tags=["admin-ai-rules"])


class UpsertAiRulesBody(BaseModel):
    implementationQualityRules: Optional[str] = None
    magentoRules: Optional[str] = None
    agentOutputContract: Optional[str] = None


@router.get("/defaults")
async def get_defaults(auth: dict = Depends(require_admin)):
    return {"defaults": get_default_rules()}


@router.get("")
async def list_project_rules(auth: dict = Depends(require_admin)):
    projects = projects_repo.list_all()
    custom_by_project = {r["projectId"]: r for r in project_ai_rules_repo.list_all()}
    return {
        "projects": [{
            "id": p["id"],
            "name": p["name"],
            "slug": p["slug"],
            "hasCustomAiRules": p["id"] in custom_by_project,
            "updatedAt": custom_by_project[p["id"]]["updatedAt"] if p["id"] in custom_by_project else None,
        } for p in projects],
    }


@router.get("/{project_id}")
async def get_project_rules(project_id: str, auth: dict = Depends(require_admin)):
    project = projects_repo.find_by_id(project_id)
    if not project:
        raise HttpError.not_found("Project not found")

    defaults = get_default_rules()
    custom = project_ai_rules_repo.find_by_project_id(project_id)
    effective = resolve_effective_rules(project_id)

    if custom:
        editable = {
            "implementationQualityRules": custom.get("implementationQualityRules") or defaults["implementationQualityRules"],
            "magentoRules": get_editable_magento_template(custom.get("magentoRules")),
            "agentOutputContract": custom.get("agentOutputContract") or defaults["agentOutputContract"],
        }
    else:
        editable = {
            "implementationQualityRules": defaults["implementationQualityRules"],
            "magentoRules": defaults["magentoRules"],
            "agentOutputContract": defaults["agentOutputContract"],
        }

    return {
        "project": {"id": project["id"], "name": project["name"], "slug": project["slug"]},
        "hasCustomAiRules": effective["hasCustomRules"],
        "usingDefaults": effective["usingDefaults"],
        "rules": editable,
        "defaults": defaults,
        "customRecord": custom,
    }


@router.put("/{project_id}")
async def upsert_project_rules(
    project_id: str,
    body: UpsertAiRulesBody,
    auth: dict = Depends(require_admin),
):
    project = projects_repo.find_by_id(project_id)
    if not project:
        raise HttpError.not_found("Project not found")

    defaults = get_default_rules()
    impl = body.implementationQualityRules
    magento = body.magentoRules
    contract = body.agentOutputContract

    if not any([impl, magento, contract]):
        raise HttpError.bad_request(
            "Provide at least one rule field (implementationQualityRules, magentoRules, or agentOutputContract)"
        )

    saved = project_ai_rules_repo.upsert(project_id, {
        "implementationQualityRules": impl if impl is not None else defaults["implementationQualityRules"],
        "magentoRules": magento if magento is not None else defaults["magentoRules"],
        "agentOutputContract": contract if contract is not None else defaults["agentOutputContract"],
    })

    activities_repo.create({
        "userId": auth["sub"],
        "username": auth["username"],
        "action": "project.ai_rules.updated",
        "resourceType": "project",
        "resourceId": project_id,
        "projectId": project_id,
        "projectName": project["name"],
        "summary": f"{auth['username']} updated AI rules for {project['name']}",
    })

    effective = resolve_effective_rules(project_id)
    return {
        "rules": saved,
        "hasCustomAiRules": effective["hasCustomRules"],
        "usingDefaults": effective["usingDefaults"],
    }


@router.delete("/{project_id}")
async def delete_project_rules(project_id: str, auth: dict = Depends(require_admin)):
    project = projects_repo.find_by_id(project_id)
    if not project:
        raise HttpError.not_found("Project not found")
    if not project_ai_rules_repo.delete(project_id):
        raise HttpError.not_found("No custom AI rules for this project")

    activities_repo.create({
        "userId": auth["sub"],
        "username": auth["username"],
        "action": "project.ai_rules.deleted",
        "resourceType": "project",
        "resourceId": project_id,
        "projectId": project_id,
        "projectName": project["name"],
        "summary": f"{auth['username']} reset AI rules to defaults for {project['name']}",
    })

    return {"ok": True, "hasCustomAiRules": False, "usingDefaults": True}
