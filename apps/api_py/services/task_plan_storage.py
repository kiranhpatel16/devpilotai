import pathlib
import re
from datetime import datetime, timezone

from config import REPO_ROOT

TASK_PLANS_DIR = pathlib.Path(REPO_ROOT) / "data" / "task-plans"


def _sanitize_segment(value: str) -> str:
    cleaned = re.sub(r"[^\w.\-]+", "-", value.strip())
    return cleaned or "unknown"


def _unique_plan_file_name(task_key: str) -> str:
    stamp = datetime.now(timezone.utc).isoformat().replace(":", "-").replace(".", "-")
    return f"{task_key}-{stamp}.md"


def save_task_plan(
    *,
    project_slug: str,
    project_name: str,
    task_key: str,
    plan_text: str,
) -> str:
    """Persist a plan-mode answer as data/task-plans/{project}/{task}/{task}-{timestamp}.md."""
    key = _sanitize_segment(task_key)
    project_dir = _sanitize_segment(project_slug or project_name)
    folder = TASK_PLANS_DIR / project_dir / key
    folder.mkdir(parents=True, exist_ok=True)
    file_path = folder / _unique_plan_file_name(key)
    file_path.write_text(plan_text.strip() + "\n", encoding="utf-8")
    return str(file_path)


def read_task_plan(plan_file_path: str) -> str:
    """Read a previously saved plan markdown file."""
    path = pathlib.Path(plan_file_path).resolve()
    plans_root = TASK_PLANS_DIR.resolve()
    if plans_root not in path.parents and path != plans_root:
        raise ValueError("Plan file path is outside task-plans directory")
    if not path.is_file():
        raise FileNotFoundError(f"Plan file not found: {plan_file_path}")
    return path.read_text(encoding="utf-8").strip()
