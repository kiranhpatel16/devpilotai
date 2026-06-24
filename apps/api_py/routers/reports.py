from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from typing import Optional
from middleware.auth import get_auth, is_admin_role
from database import get_db
from db.runs import runs_repo
from db.project_roles import project_roles_repo

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/summary")
async def reports_summary(
    from_date: Optional[str] = Query(default=None, alias="from"),
    to_date: Optional[str] = Query(default=None, alias="to"),
    projectId: Optional[str] = Query(default=None),
    auth: dict = Depends(get_auth),
):
    now = datetime.now(timezone.utc)
    start = from_date or (now - timedelta(days=30)).isoformat()
    end = to_date or now.isoformat()

    if is_admin_role(auth["role"]):
        rows = get_db().execute(
            """SELECT * FROM runs WHERE mode='workflow' AND created_at >= ? AND created_at <= ?""",
            (start, end),
        ).fetchall()
    else:
        rows = get_db().execute(
            """SELECT * FROM runs WHERE user_id=? AND mode='workflow'
               AND created_at >= ? AND created_at <= ?""",
            (auth["sub"], start, end),
        ).fetchall()

    runs = [dict(r) for r in rows]
    if projectId:
        runs = [r for r in runs if r["project_id"] == projectId]

    completed = sum(1 for r in runs if r["status"] == "done")
    prs = sum(1 for r in runs if r["status"] in ("commit_ready", "pushing", "pr_creating", "done"))

    usage_rows = get_db().execute(
        """SELECT SUM(input_tokens) as inp, SUM(output_tokens) as outp
           FROM run_ai_usage WHERE created_at >= ? AND created_at <= ?""",
        (start, end),
    ).fetchone()

    return {
        "period": {"from": start, "to": end},
        "tasksCompleted": completed,
        "aiGeneratedPrs": prs,
        "hoursSaved": round(completed * 2.5, 1),
        "bugsPrevented": max(0, completed // 3),
        "deployments": sum(1 for r in runs if r["status"] == "done"),
        "tokenUsage": {
            "input": usage_rows["inp"] or 0,
            "output": usage_rows["outp"] or 0,
        },
    }
