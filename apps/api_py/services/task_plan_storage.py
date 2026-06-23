import pathlib
import re
from config import REPO_ROOT

TASK_PLANS_DIR = pathlib.Path(REPO_ROOT) / "data" / "task-plans"


def _sanitize_segment(value: str) -> str:
    cleaned = re.sub(r"[^\w.\-]+", "-", value.strip())
    return cleaned or "unknown"


def save_task_plan(
    *,
    project_slug: str,
    project_name: str,
    task_key: str,
    plan_text: str,
) -> str:
    """Persist a plan-mode answer as data/task-plans/{project}/{task}/{task}.md."""
    key = _sanitize_segment(task_key)
    project_dir = _sanitize_segment(project_slug or project_name)
    folder = TASK_PLANS_DIR / project_dir / key
    folder.mkdir(parents=True, exist_ok=True)
    file_path = folder / f"{key}.md"
    file_path.write_text(plan_text.strip() + "\n", encoding="utf-8")
    return str(file_path)
