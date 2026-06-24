from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from typing import Optional
from middleware.auth import get_auth, is_admin_role
from db.project_roles import project_roles_repo
from db.knowledge import knowledge_repo
from lib.errors import HttpError

router = APIRouter(prefix="/api/knowledge", tags=["knowledge"])


def _assert_access(auth: dict, project_id: str):
    if is_admin_role(auth["role"]):
        return
    if not project_roles_repo.get_role(auth["sub"], project_id):
        raise HttpError.forbidden("You are not assigned to this project")


class CreateDocumentBody(BaseModel):
    projectId: str
    category: str = "project_docs"
    title: str
    content: str = ""
    tags: Optional[list[str]] = None


@router.get("")
async def list_documents(
    projectId: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    auth: dict = Depends(get_auth),
):
    if projectId:
        _assert_access(auth, projectId)
    docs = knowledge_repo.list_documents(projectId, category)
    return {"documents": docs}


@router.post("", status_code=201)
async def create_document(body: CreateDocumentBody, auth: dict = Depends(get_auth)):
    _assert_access(auth, body.projectId)
    doc = knowledge_repo.create({
        "projectId": body.projectId,
        "category": body.category,
        "title": body.title,
        "content": body.content,
        "tags": body.tags,
        "createdBy": auth["sub"],
    })
    return {"document": doc}


@router.get("/search")
async def search_knowledge(
    projectId: str,
    q: str = Query(min_length=1),
    auth: dict = Depends(get_auth),
):
    _assert_access(auth, projectId)
    return {"results": knowledge_repo.search(projectId, q)}
