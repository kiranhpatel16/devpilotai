import os
import re

SCAN_ROOTS = ["app/code", "app/design"]
SKIP_DIRS = {"vendor", "generated", "var", "pub", "node_modules", ".git", "i18n", "web"}
CODE_EXT = {".php", ".phtml", ".xml", ".html", ".js"}
MAX_TRAVERSE = 40_000
MAX_EXCERPTS = 12
EXCERPT_CHARS = 3_500

STOPWORDS = {
    "the", "and", "for", "with", "add", "fix", "page", "home", "update", "change",
    "create", "new", "issue", "show", "this", "that", "from", "into", "when",
    "please", "work", "task", "magento", "should", "will", "need", "want", "make",
}


def extract_keywords(text: str) -> list[str]:
    tokens = re.split(r"[^a-z0-9]+", text.lower())
    seen = set()
    result = []
    for t in tokens:
        if len(t) >= 4 and t not in STOPWORDS and t not in seen:
            seen.add(t)
            result.append(t)
    return result[:20]


def list_frontend_themes(cwd: str) -> list[str]:
    themes_root = os.path.join(cwd, "app/design/frontend")
    themes = []
    try:
        for vendor in os.listdir(themes_root):
            vendor_path = os.path.join(themes_root, vendor)
            if not os.path.isdir(vendor_path):
                continue
            for theme in os.listdir(vendor_path):
                if os.path.isdir(os.path.join(vendor_path, theme)):
                    themes.append(f"{vendor}/{theme}")
    except Exception:
        pass
    return themes


def _build_overview(cwd: str, active_theme: str | None = None) -> str:
    lines = []
    themes = list_frontend_themes(cwd)
    if themes:
        lines.append(f"Frontend themes (app/design/frontend): {', '.join(themes)}")
    if active_theme:
        lines.append(
            f"ACTIVE frontend theme: {active_theme} — make ALL theme/template/layout edits "
            f"under app/design/frontend/{active_theme}/ and do not touch other themes."
        )

    code_root = os.path.join(cwd, "app/code")
    modules = []
    try:
        for vendor in os.listdir(code_root):
            vpath = os.path.join(code_root, vendor)
            if not os.path.isdir(vpath):
                continue
            for mod in os.listdir(vpath):
                if os.path.isdir(os.path.join(vpath, mod)):
                    modules.append(f"{vendor}_{mod}")
    except Exception:
        pass

    if modules:
        displayed = modules[:60]
        ellipsis = ", …" if len(modules) > 60 else ""
        lines.append(f"Custom modules (app/code, {len(modules)}): {', '.join(displayed)}{ellipsis}")

    if not lines:
        lines.append("No app/code or app/design directories found at the project root.")
    return "\n".join(lines)


def _collect_files(cwd: str) -> list[str]:
    out = []
    traversed = [0]

    def walk(directory: str) -> None:
        if traversed[0] > MAX_TRAVERSE:
            return
        try:
            entries = list(os.scandir(directory))
        except Exception:
            return
        for e in entries:
            traversed[0] += 1
            if traversed[0] > MAX_TRAVERSE:
                return
            if e.is_dir(follow_symlinks=False):
                if e.name in SKIP_DIRS:
                    continue
                walk(e.path)
            elif os.path.splitext(e.name)[1] in CODE_EXT:
                out.append(e.path)

    for root in SCAN_ROOTS:
        full = os.path.join(cwd, root)
        if os.path.exists(full):
            walk(full)
    return out


def _score_by_path(rel_path: str, keywords: list[str], active_theme: str | None) -> float:
    lower = rel_path.lower()
    score = 0.0
    for kw in keywords:
        if kw in lower:
            score += 1
    if re.search(r"/layout/.*\.xml$", lower):
        score += 0.5
    if lower.endswith(".phtml"):
        score += 0.25
    if active_theme:
        theme_seg = f"app/design/frontend/{active_theme.lower()}/"
        if lower.startswith(theme_seg):
            score += 2
        elif lower.startswith("app/design/frontend/"):
            score -= 1
    return score


def build_repo_context(cwd: str, task_text: str, active_theme: str | None = None) -> dict:
    overview = _build_overview(cwd, active_theme)
    keywords = extract_keywords(task_text)

    if not keywords:
        return {"overview": overview, "excerpts": []}

    files = _collect_files(cwd)
    scored = []
    for full in files:
        rel = os.path.relpath(full, cwd)
        score = _score_by_path(rel, keywords, active_theme)
        if score > 0:
            scored.append((score, full, rel))
    scored.sort(key=lambda x: -x[0])
    scored = scored[:MAX_EXCERPTS]

    excerpts = []
    for _, full, rel in scored:
        try:
            with open(full, "r", encoding="utf-8", errors="replace") as f:
                content = f.read(EXCERPT_CHARS)
            excerpts.append({"path": rel, "content": content})
        except Exception:
            pass

    return {"overview": overview, "excerpts": excerpts}
