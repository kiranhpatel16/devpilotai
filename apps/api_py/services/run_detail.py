import json
from db.runs import runs_repo

EMPTY_DETAIL = {
    "output": None,
    "diffs": [],
    "applied": False,
    "test": None,
    "deploy": None,
    "git": None,
    "usage": None,
    "backups": [],
    "currentStep": "select",
    "completedSteps": [],
    "jiraSnapshot": None,
    "customTitle": None,
    "customTaskKey": None,
    "customRequirements": None,
    "planMarkdown": None,
    "planFilePath": None,
    "planApprovedAt": None,
    "planApprovedBy": None,
    "approvalStatus": "draft",
    "jiraCommentPostedAt": None,
    "jiraCommentId": None,
    "jiraCommentText": None,
    "testPassRate": None,
}


def load_detail(run_id: str) -> dict:
    json_str = runs_repo.get_detail_json(run_id)
    if not json_str:
        return dict(EMPTY_DETAIL)
    try:
        stored = json.loads(json_str)
        merged = {**EMPTY_DETAIL, **stored}
        if merged.get("diffs") is None:
            merged["diffs"] = []
        if merged.get("completedSteps") is None:
            merged["completedSteps"] = []
        if merged.get("output") and isinstance(merged["output"], dict):
            out = merged["output"]
            if out.get("files") is None:
                out["files"] = []
            if out.get("manualTestChecklist") is None:
                out["manualTestChecklist"] = []
            if out.get("risks") is None:
                out["risks"] = []
        return merged
    except Exception:
        return dict(EMPTY_DETAIL)


def save_detail(run_id: str, detail: dict) -> None:
    runs_repo.set_detail_json(run_id, json.dumps(detail))


def patch_detail(run_id: str, patch: dict) -> dict:
    current = load_detail(run_id)
    next_detail = {**current, **patch}
    save_detail(run_id, next_detail)
    return next_detail
