DEPLOY_FIX_RULES = """You are fixing a Magento deploy failure (setup:upgrade, compilation, static content deploy, composer, PHP/runtime errors, etc.).
Rules:
- Fix ONLY the file(s) named in the deploy error output or PRIMARY FIX TARGETS list — whatever extension they use.
- Do NOT change unrelated files. Read the error message, stack trace, and file path; edit the file(s) it actually points to.
- Apply the correct fix for the failing file type:
  * .xml (etc/*.xml, layout, db_schema, webapi, di, module, etc.): valid Magento XSD, correct root element and namespace for that file.
  * .php: valid PHP 8.3 syntax, correct namespaces/use statements, constructor DI, real method bodies — no stubs.
  * .phtml: valid template syntax; if the template changed, ensure matching layout XML references it.
  * .js / .css / .less / .scss: valid syntax; compatible with Magento static content / theme build.
  * .json (composer.json, etc.): valid JSON; fix version/dependency issues only when the error says so.
  * Other paths in the error (app/code, app/design, generated, etc.): minimal fix for that file and error only.
- Common XML specifics when relevant:
  * db_schema.xml: identity= not auto_increment; never use primary= on <column> — use <constraint xsi:type="primary" referenceId="PRIMARY"> with nested <column name="..."/>; constraints use nested <column/> children (not columns= attribute).
  * webapi.xml: root <routes> with xsi:noNamespaceSchemaLocation="urn:magento:module:Magento_Webapi:etc/webapi.xsd"; every <route> must include <service> and <resources><resource ref="..."/></resources>
- Return the smallest change set that makes deployment succeed. Add PHPUnit tests only when you change PHP classes that require them; skip tests for config/XML/CSS/JS-only fixes.
- PHP syntax/parse errors (unmatched braces, parse errors): return the ENTIRE corrected file as action=modify with "content" (full file). Do NOT use "edits" for brace/syntax fixes. Do NOT add new methods unless the syntax error requires it — fix the minimal brace/statement issue only."""

DEPLOY_FIX_OUTPUT_CONTRACT = """Respond with ONLY a JSON object (no prose, no markdown fences) of this exact shape:
{
  "summary": "one sentence describing the fix",
  "files": [
    {
      "path": "app/code/Vendor/Module/...",
      "action": "create | modify | delete",
      "reason": "why this file changes",
      "content": "FULL file content — for action=create OR action=modify when fixing PHP syntax/parse errors",
      "edits": [
        { "oldString": "exact existing text", "newString": "replacement", "replaceAll": false }
      ]
    }
  ],
  "manualTestChecklist": ["Re-run local deploy"],
  "risks": []
}
CRITICAL rules for deploy fixes:
- Fix ONLY files named in the deploy error. Smallest change that makes deploy succeed.
- PHP syntax/parse errors (unmatched }, unexpected token, parse error): action=modify with FULL corrected file in "content". Do NOT use "edits". Balance all braces. Do not add unrelated methods.
- XML/config errors: prefer small targeted "edits" with oldString copied verbatim from the excerpt.
- action=create: provide full "content" only.
- action=modify with "edits": oldString must match the excerpt exactly. Never insert extra closing braces without removing matching opens.
- Proposed PHP MUST pass php -l — invalid syntax will be rejected automatically.
- Skip PHPUnit tests unless you change PHP class behavior (syntax-only fixes need no tests)."""

IMPLEMENTATION_QUALITY_RULES = """Implementation quality (mandatory — responses violating these are REJECTED):
- Write PRODUCTION-READY code like a senior developer using Cursor IDE. Every method must contain real executable logic.
- FORBIDDEN: placeholder comments ("// Logic to...", "// TODO", "// implement"), empty method bodies, duplicate comment lines, or edits that only add comments.
- FORBIDDEN: describing work in comments instead of writing code. If the summary says "implemented X", the code must actually do X.
- Observers: inject services via constructor (DI), call real methods (e.g. $this->feedRegenerator->markDirty()).
- API/service classes: implement full method bodies with repositories, resource models, or collections — not comment stubs.
- XML must be valid Magento schema (db_schema: identity= not auto_increment; constraints use nested <column/> children).
- Wire dependencies in etc/di.xml. Register events, webapi routes, and console commands as needed.
- ALWAYS include PHPUnit unit tests for new/changed PHP classes under app/code/Vendor/Module/Test/Unit/.
- Tests must instantiate the class (with mocks) and assert real behavior — not empty test bodies."""

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
- action="create": provide "content" (the complete new file). Do NOT provide "edits".
- action="modify": provide "edits" — targeted search/replace. Do NOT return full file content for modify.
    * "oldString" MUST be copied VERBATIM from the provided file excerpt (exact whitespace/indentation).
    * When replacing a stub method, set oldString to the ENTIRE method (signature + body) and newString to the full new method with real logic.
    * NEVER add a comment line as the only change. newString must contain executable PHP statements.
- action="delete": no "content" or "edits".
- Use repository-relative paths. Only include files you actually change.
- Include Test/Unit/*.php files for every new Observer, Model, Service, or API class you create or substantially change.

BAD modify edit (REJECTED):
  oldString: "    public function execute(Observer $observer) {\\n        // Logic to set feed_status = DIRTY\\n    }"
  newString: "    public function execute(Observer $observer) {\\n        // Logic to set feed_status = DIRTY\\n\\n        // Logic to set feed_status = DIRTY\\n    }"

GOOD modify edit (ACCEPTED):
  oldString: "    public function execute(Observer $observer) {\\n        // Logic to set feed_status = DIRTY\\n    }"
  newString: "    public function __construct(\\n        private readonly FeedRegenerator $feedRegenerator\\n    ) {}\\n\\n    public function execute(Observer $observer): void\\n    {\\n        $this->feedRegenerator->markDirty();\\n    }"

GOOD test file (REQUIRED for new PHP classes):
  path: app/code/Vendor/Module/Test/Unit/Observer/ProductSaveAfterTest.php
  action: create
  content: full PHPUnit test class with mocks and assertions"""

DEFAULT_MAGENTO_RULES_TEMPLATE = """You are a senior Magento 2 engineer working on a Hyva + Tailwind + Magewire storefront.
Environment: PHP 8.3, MariaDB 10.6. Magento Admin is the source of truth.
You work like Cursor IDE: read the task, write complete working code, add unit tests, and wire everything in DI/XML.
Rules:
- No core edits. Use DI, plugins, observers, and service contracts.
- Follow existing module structure under app/code/ and theme structure under app/design/.
- Use ONLY paths that exist in the provided repository context (themes, modules, file excerpts). Do NOT invent vendor/theme/module names or guess file paths.
- A template (.phtml) renders ONLY when a layout XML block references it. If you create or change a template, you MUST also add/modify the matching layout XML (e.g. <referenceContainer>/<block ... template="Vendor_Module::path.phtml"/>) so the change actually takes effect.
- Edit inside the ACTIVE custom theme or a custom module — never core or vendor code.
- The storefront home page is typically a CMS page (Admin → Content → Pages), not a phtml; do not assume a home.phtml renders unless layout wiring proves it.
- Keep Hyva templates clean; use Tailwind utility classes. Use Magewire only where server-synced interactivity is needed.
- Deliver the FULL feature from the task/plan — not scaffolding, not comments describing what code should do.

{IMPLEMENTATION_QUALITY_RULES}"""

MAGENTO_RULES = DEFAULT_MAGENTO_RULES_TEMPLATE.replace(
    "{IMPLEMENTATION_QUALITY_RULES}", IMPLEMENTATION_QUALITY_RULES
)


from services.prompt_budget import (
    MAX_JIRA_DESCRIPTION_CHARS,
    MAX_PLAN_CHARS,
    MAX_DEPLOY_OUTPUT_CHARS,
    trim_text,
)


def _rules_for_ctx(ctx: dict) -> dict:
    from services.ai_rules import resolve_effective_rules

    project = ctx.get("project") or {}
    project_id = project.get("id")
    if ctx.get("aiRules"):
        rules = ctx["aiRules"]
        return {
            "magentoRules": rules["magentoRules"],
            "agentOutputContract": rules["agentOutputContract"],
        }
    effective = resolve_effective_rules(project_id)
    return {
        "magentoRules": effective["magentoRules"],
        "agentOutputContract": effective["agentOutputContract"],
    }


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
        trim_text(jira.get("description") or "(none)", MAX_JIRA_DESCRIPTION_CHARS),
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


def _validation_retry_block(ctx: dict) -> str:
    errors = ctx.get("validationErrors") or []
    if not errors:
        return ""
    mode = ctx.get("mode")
    if mode == "deploy_fix":
        lines = [
            "\n\n*** YOUR PREVIOUS FIX WAS REJECTED ***",
            "Fix these problems in this response:",
            *[f"- {err}" for err in errors],
        ]
        if any("parse error" in e.lower() or "syntax" in e.lower() or "unmatched" in e.lower() for e in errors):
            lines.extend([
                "\nFor PHP syntax errors:",
                '- Return action="modify" with the FULL corrected PHP file in "content" (not "edits").',
                "- Balance all { and }. Fix only the reported syntax issue — no new methods.",
                "- The file must pass php -l before it can be applied.",
            ])
        else:
            lines.append("\nReturn a corrected minimal fix for the deploy error only.")
        return "\n".join(lines)
    lines = [
        "\n\n*** YOUR PREVIOUS RESPONSE WAS REJECTED ***",
        "The following problems must be fixed in this response:",
        *[f"- {err}" for err in errors],
        "\nRewrite the COMPLETE proposal with:",
        "- Real PHP implementations (constructor DI + method bodies with executable statements)",
        "- NO placeholder comments or duplicate comment lines",
        "- PHPUnit Test/Unit classes for each new/changed PHP class",
        "- For stub files, prefer action=create with full file content OR replace entire methods in edits",
    ]
    return "\n".join(lines)


def build_prompt(ctx: dict) -> dict:
    project = ctx["project"]
    rules = _rules_for_ctx(ctx)
    magento_rules = rules["magentoRules"]
    agent_output_contract = rules["agentOutputContract"]
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
    validation_block = _validation_retry_block(ctx)

    if mode == "agent":
        prior_output = ctx.get("priorOutput")
        approved_plan = ctx.get("approvedPlanMarkdown")
        plan_block = ""
        if approved_plan:
            plan_block = (
                f"\n\nYou MUST implement this approved plan exactly:\n\n"
                f"{trim_text(approved_plan, MAX_PLAN_CHARS)}\n\n"
                "Follow the plan's steps, files, and test checklist."
            )
        if prior_output:
            prior_files = "\n".join(f"- {f['action']}: {f['path']}" for f in prior_output.get("files", []))
            refine_block = (
                f"\n\nYou previously proposed this change:\nSummary: {prior_output.get('summary', '')}\n"
                f"Files:\n{prior_files}\n\nThe developer now requests an ADDITIONAL change on top of that proposal:\n"
                f"{ctx.get('refineInstructions', '')}\n\nReturn an UPDATED, COMPLETE proposal "
                "(include every file that should change, not just the new part), following the same JSON contract and edit rules. "
                "Replace any stub/placeholder code with full implementations."
            )
            return {
                "system": f"{magento_rules}\n\n{agent_output_contract}",
                "user": f"Refine the implementation for the following task.\n\n{common}{plan_block}{refine_block}{validation_block}",
                "jsonMode": True,
            }
        return {
            "system": f"{magento_rules}\n\n{agent_output_contract}",
            "user": (
                f"Implement the following task with COMPLETE, production-ready code and PHPUnit unit tests. "
                f"Work like Cursor IDE — write real implementations, not comments describing logic.\n\n"
                f"{common}{plan_block}{validation_block}"
            ),
            "jsonMode": True,
        }

    if mode == "deploy_fix":
        analysis = ctx.get("deployAnalysis") or {}
        deploy_output = trim_text(ctx.get("deployOutput") or "", MAX_DEPLOY_OUTPUT_CHARS)
        issue_lines = "\n".join(
            f"- {i.get('kind')}: {i.get('message')}" for i in analysis.get("issues") or []
        )
        error_files = analysis.get("errorFiles") or []
        target_block = ""
        if error_files:
            target_block = (
                "\n\nPRIMARY FIX TARGETS (edit these files — they are named in the deploy error):\n"
                + "\n".join(f"- {path}" for path in error_files)
            )
        deploy_excerpts = ctx.get("deployFileExcerpts") or []
        excerpt_block = ""
        if deploy_excerpts:
            lines = ["\nFiles related to the deploy failure (read before editing):"]
            for f in deploy_excerpts:
                lines.append(f"\n--- {f['path']} ---\n{f['content']}")
            excerpt_block = "\n".join(lines)
        approved_plan = ctx.get("approvedPlanMarkdown")
        plan_block = ""
        if approved_plan:
            plan_block = (
                f"\n\nApproved implementation plan (context only — do not fix unrelated files):\n\n"
                f"{trim_text(approved_plan, MAX_PLAN_CHARS)}"
            )
        last_fix = ctx.get("lastFailedFix")
        retry_block = ""
        prior_apply_error = (last_fix or {}).get("applyError") if last_fix else None
        if not prior_apply_error:
            current_last = ctx.get("deployLastFix")
            if current_last and current_last.get("status") == "proposed":
                prior_apply_error = current_last.get("applyError")
        if prior_apply_error:
            retry_block = (
                f"\n\n*** PREVIOUS APPLY FAILED PHP SYNTAX CHECK ***\n"
                f"{prior_apply_error}\n"
                "Return the FULL corrected file in content (not edits). Fix brace balance only."
            )
        elif last_fix and last_fix.get("paths"):
            retry_block = (
                "\n\n*** PREVIOUS FIX DID NOT WORK — DO NOT REPEAT ***\n"
                f"Summary attempted: {last_fix.get('summary', '(none)')}\n"
                f"Files changed: {', '.join(last_fix.get('paths') or [])}\n"
                "The deploy error below is still failing. Propose a DIFFERENT fix targeting "
                "the file(s) in the deploy error output, not the same files unless the error still points there."
            )
        syntax_lines = []
        for issue in analysis.get("issues") or []:
            if issue.get("kind") not in ("php_syntax", "php_runtime"):
                continue
            rel = issue.get("file")
            if not rel:
                continue
            line_nums = issue.get("lines") or []
            near = f" near line {line_nums[0]}" if line_nums else ""
            syntax_lines.append(
                f"- {rel}{near}: return FULL corrected file via action=modify + content (not edits)"
            )
        syntax_block = ""
        if syntax_lines:
            syntax_block = (
                "\n\nPHP syntax fix required (minimal change, valid php -l):\n"
                + "\n".join(syntax_lines)
            )
        slim_common = (
            f"{project_block}\n\n{_jira_block(ctx)}{user_block}{_repo_block(ctx)}"
        )
        return {
            "system": f"{DEPLOY_FIX_RULES}\n\n{DEPLOY_FIX_OUTPUT_CONTRACT}",
            "user": (
                "A local Magento deployment failed. Fix the error with minimal, targeted file changes.\n\n"
                f"{slim_common}{plan_block}{target_block}{retry_block}{syntax_block}\n\n"
                f"Deploy failure summary: {analysis.get('summary', 'Unknown')}\n"
                f"Failed step: {analysis.get('failedStep') or 'unknown'}\n"
                f"Issues:\n{issue_lines or '(see deploy output below)'}\n\n"
                f"Deploy command output (excerpt):\n{deploy_output}\n"
                f"{excerpt_block}\n\n"
                "Fix the deploy error only. Return the smallest change set that makes deployment succeed."
                f"{validation_block}"
            ),
            "jsonMode": True,
        }

    if mode == "plan":
        return {
            "system": f"{magento_rules}\n\nProduce a clear implementation plan. Do NOT write file contents. Use concise markdown with steps, files to touch, and a test checklist.",
            "user": f"Create an implementation plan for this task.\n\n{common}",
            "jsonMode": False,
        }

    if mode == "debug":
        return {
            "system": f"{magento_rules}\n\nYou are debugging. Analyze the problem, identify likely causes, and propose a minimal fix. Use concise markdown.",
            "user": f"Investigate and propose a fix for this issue.\n\n{common}",
            "jsonMode": False,
        }

    # ask
    return {
        "system": f"{magento_rules}\n\nAnswer the question clearly and concisely in markdown.",
        "user": common,
        "jsonMode": False,
    }
