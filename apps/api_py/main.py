import sys
import os

# Ensure the api_py directory is on sys.path so all imports resolve
sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

import config as cfg
from database import get_db

from routers.auth import router as auth_router
from routers.admin_users import router as admin_users_router
from routers.admin_projects import router as admin_projects_router
from routers.admin_activities import router as admin_activities_router
from routers.admin_ai_providers import router as admin_ai_providers_router
from routers.projects import router as projects_router
from routers.jira import router as jira_router
from routers.ai import router as ai_router
from routers.runs import router as runs_router
from routers.workflow import router as workflow_router

# Initialise DB on startup
get_db()

app = FastAPI(title="CPWork API", version="1.0.0", redirect_slashes=False)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[cfg.WEB_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    detail = exc.detail
    if isinstance(detail, dict):
        return JSONResponse(status_code=exc.status_code, content=detail)
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": str(detail), "code": "http_error"},
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(
        status_code=422,
        content={"error": "Validation error", "code": "validation_error", "detail": exc.errors()},
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    import logging
    logging.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"error": "Internal server error", "code": "internal_error"},
    )


@app.get("/api/health")
async def health():
    return {"ok": True, "service": "cpwork-api", "env": cfg.ENV}


app.include_router(auth_router)
app.include_router(admin_users_router)
app.include_router(admin_projects_router)
app.include_router(admin_activities_router)
app.include_router(admin_ai_providers_router)
app.include_router(ai_router)
app.include_router(jira_router)
app.include_router(projects_router)
app.include_router(workflow_router)
app.include_router(runs_router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=cfg.PORT, reload=cfg.ENV != "production")
