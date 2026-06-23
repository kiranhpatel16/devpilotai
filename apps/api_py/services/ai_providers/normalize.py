import json
import re


def _extract_json(raw: str) -> str | None:
    fenced = re.search(r"```(?:json)?\s*([\s\S]*?)```", raw, re.IGNORECASE)
    candidate = fenced.group(1) if fenced else raw
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    return candidate[start: end + 1]


def _as_action(value) -> str:
    if value in ("create", "delete"):
        return value
    return "modify"


def _as_edits(value) -> list | None:
    if not isinstance(value, list):
        return None
    edits = [
        {
            "oldString": e["oldString"],
            "newString": e["newString"],
            "replaceAll": bool(e.get("replaceAll", False)),
        }
        for e in value
        if isinstance(e, dict) and isinstance(e.get("oldString"), str) and isinstance(e.get("newString"), str)
    ]
    return edits if edits else None


def _as_string_array(value) -> list[str]:
    if not isinstance(value, list):
        return []
    return [v if isinstance(v, str) else str(v) for v in value if v]


def normalize_agent_output(raw: str) -> dict:
    text = raw.strip()
    json_str = _extract_json(raw)

    if not json_str:
        return {"summary": "", "files": [], "manualTestChecklist": [], "risks": [], "text": text}

    try:
        parsed = json.loads(json_str)
    except Exception:
        return {"summary": "", "files": [], "manualTestChecklist": [], "risks": [], "text": text}

    files = []
    if isinstance(parsed.get("files"), list):
        for f in parsed["files"]:
            if not isinstance(f, dict) or not isinstance(f.get("path"), str):
                continue
            files.append({
                "path": f["path"],
                "action": _as_action(f.get("action")),
                "reason": f.get("reason") if isinstance(f.get("reason"), str) else None,
                "content": f.get("content") if isinstance(f.get("content"), str) else None,
                "edits": _as_edits(f.get("edits")),
            })

    return {
        "summary": parsed.get("summary", "") if isinstance(parsed.get("summary"), str) else "",
        "files": files,
        "manualTestChecklist": _as_string_array(parsed.get("manualTestChecklist")),
        "risks": _as_string_array(parsed.get("risks")),
        "text": text,
    }
