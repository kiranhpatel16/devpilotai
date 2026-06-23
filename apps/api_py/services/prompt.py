MAGENTO_RULES = """You are a senior Magento 2 engineer working on a Hyva + Tailwind + Magewire storefront.
Environment: PHP 8.3, MariaDB 10.6. Magento Admin is the source of truth.
Rules:
- No core edits. Use DI, plugins, observers, and service contracts.
- Follow existing module structure under app/code/ and theme structure under app/design/.
- Use ONLY paths that exist in the provided repository context (themes, modules, file excerpts). Do NOT invent vendor/theme/module names or guess file paths.
- A template (.phtml) renders ONLY when a layout XML block references it. If you create or change a template, you MUST also add/modify the matching layout XML (e.g. <referenceContainer>/<block ... template="Vendor_Module::path.phtml"/>) so the change actually takes effect.
- Edit inside the ACTIVE custom theme or a custom module — never core or vendor code.
- The storefront home page is typically a CMS page (Admin → Content → Pages), not a phtml; do not assume a home.phtml renders unless layout wiring proves it.
- Keep Hyva templates clean; use Tailwind utility classes. Use Magewire only where server-synced interactivity is needed.
- Prefer small, focused changes that satisfy the task and are verifiably wired in."""

AGENT_OUTPUT_CONTRACT = """Respond with ONLY a JSON object (no prose, no markdown fences) of this exact shape:
{
  "summary": "one sentence describing the change",
  "files": [
    {
      "path": "app/code/Vendor/Module/...",
      "action": "create | modify | delete",
      "reason": "why this file changes",
      "content": "FULL file content — ONLY for action=create",
      "edits": [
        { "oldString": "exact existing text to find", "newString": "replacement text", "replaceAll": false }
      ]
    }
  ],
  "manualTestChecklist": ["step 1", "step 2"],
  "risks": ["risk 1"]
}
CRITICAL rules for files:
- action="create": provide "content" (the full new file). Do NOT provide "edits".
- action="modify": provide "edits" — a list of targeted search/replace operations. Do NOT return full file content for a modify; that would destroy unrelated code.
    * "oldString" MUST be copied VERBATIM from the provided file excerpt (exact whitespace/indentation) and include enough surrounding lines to be UNIQUE in that file.
    * Preserve everything you are not explicitly changing.
    * To INSERT without deleting, set "oldString" to an existing nearby line and include that same line plus your new lines in "newString".
    * Keep each oldString small and focused on the specific lines/section to change — never the whole file.
- action="delete": no "content" or "edits".
- Use repository-relative paths. Only include files you actually change. Never modify a file you have not seen in the provided excerpts unless you are creating it new."""


def _jira_block(ctx: dict) -> str:
    jira = ctx.get("jira")
    jira_key = ctx.get("jiraKey")
    if not jira:
        return f"Jira task: {jira_key} (details unavailable)" if jira_key else "No Jira task linked."
    parts = [
        f"Jira task: {jira['key']} — {jira['summary']}",
        f"Type: {jira['issueType']}" if jira.get("issueType") else "",
        f"Priority: {jira['priority']}" if jira.get("priority") else "",
        f"Labels: {', '.join(jira['labels'])}" if jira.get("labels") else "",
        "",
        "Description:",
        jira.get("description") or "(none)",
        f"\nAttachments: {', '.join(a['filename'] for a in jira['attachments'])}" if jira.get("attachments") else "",
    ]
    return "\n".join(p for p in parts if p is not None)


def _repo_block(ctx: dict) -> str:
    overview = ctx.get("repoOverview")
    return f"\nRepository map:\n{overview}" if overview else ""


def _excerpts_block(ctx: dict) -> str:
    excerpts = ctx.get("fileExcerpts") or []
    if not excerpts:
        return "\n(No matching existing files were found for this task — inspect the repository map and choose real paths.)"
    lines = ["\nRelevant existing files (read these before deciding what to change):"]
    for f in excerpts:
        lines.append(f"\n--- {f['path']} ---\n{f['content'][:4000]}")
    return "\n".join(lines)


def build_prompt(ctx: dict) -> dict:
    project = ctx["project"]
    project_block_parts = [
        f"Project: {project['name']}",
        f"Local path: {ctx['cwd']}",
        f"Active frontend theme: {ctx['activeTheme']}" if ctx.get("activeTheme") else "",
        f"Frontend: {ctx['frontendUrl']}" if ctx.get("frontendUrl") else "",
        f"Admin: {ctx['backendUrl']}" if ctx.get("backendUrl") else "",
    ]
    project_block = "\n".join(p for p in project_block_parts if p)
    user_block = f"\nDeveloper instructions:\n{ctx['userInstructions']}" if ctx.get("userInstructions") else ""
    common = f"{project_block}\n\n{_jira_block(ctx)}{user_block}{_repo_block(ctx)}{_excerpts_block(ctx)}"

    mode = ctx["mode"]

    if mode == "agent":
        prior_output = ctx.get("priorOutput")
        approved_plan = ctx.get("approvedPlanMarkdown")
        plan_block = ""
        if approved_plan:
            plan_block = (
                f"\n\nYou MUST implement this approved plan exactly:\n\n{approved_plan}\n\n"
                "Follow the plan's steps, files, and test checklist."
            )
        if prior_output:
            prior_files = "\n".join(f"- {f['action']}: {f['path']}" for f in prior_output.get("files", []))
            refine_block = (
                f"\n\nYou previously proposed this change:\nSummary: {prior_output.get('summary', '')}\n"
                f"Files:\n{prior_files}\n\nThe developer now requests an ADDITIONAL change on top of that proposal:\n"
                f"{ctx.get('refineInstructions', '')}\n\nReturn an UPDATED, COMPLETE proposal "
                "(include every file that should change, not just the new part), following the same JSON contract and edit rules."
            )
            return {
                "system": f"{MAGENTO_RULES}\n\n{AGENT_OUTPUT_CONTRACT}",
                "user": f"Refine the implementation for the following task.\n\n{common}{plan_block}{refine_block}",
                "jsonMode": True,
            }
        return {
            "system": f"{MAGENTO_RULES}\n\n{AGENT_OUTPUT_CONTRACT}",
            "user": f"Implement the following task.\n\n{common}{plan_block}",
            "jsonMode": True,
        }

    if mode == "plan":
        return {
            "system": f"{MAGENTO_RULES}\n\nProduce a clear implementation plan. Do NOT write file contents. Use concise markdown with steps, files to touch, and a test checklist.",
            "user": f"Create an implementation plan for this task.\n\n{common}",
            "jsonMode": False,
        }

    if mode == "debug":
        return {
            "system": f"{MAGENTO_RULES}\n\nYou are debugging. Analyze the problem, identify likely causes, and propose a minimal fix. Use concise markdown.",
            "user": f"Investigate and propose a fix for this issue.\n\n{common}",
            "jsonMode": False,
        }

    # ask
    return {
        "system": f"{MAGENTO_RULES}\n\nAnswer the question clearly and concisely in markdown.",
        "user": common,
        "jsonMode": False,
    }
