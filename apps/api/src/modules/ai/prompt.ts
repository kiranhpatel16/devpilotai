import type { AgentOutput, JiraIssueDetail, Project, RunMode } from '@cpwork/shared';

export interface PromptContext {
  project: Project;
  cwd: string;
  frontendUrl: string | null;
  backendUrl: string | null;
  mode: RunMode;
  jira: JiraIssueDetail | null;
  jiraKey: string | null;
  userInstructions: string | null;
  /** The active frontend theme path for this project, if configured. */
  activeTheme?: string | null;
  /** Structural map of the repo (themes, modules). */
  repoOverview?: string | null;
  /** Optional excerpts of relevant files already read from disk. */
  fileExcerpts?: { path: string; content: string }[];
  /** Previous proposal being refined (agent refine flow). */
  priorOutput?: AgentOutput | null;
  /** Developer's follow-up request on top of the prior proposal. */
  refineInstructions?: string | null;
}

const MAGENTO_RULES = `You are a senior Magento 2 engineer working on a Hyva + Tailwind + Magewire storefront.
Environment: PHP 8.3, MariaDB 10.6. Magento Admin is the source of truth.
Rules:
- No core edits. Use DI, plugins, observers, and service contracts.
- Follow existing module structure under app/code/ and theme structure under app/design/.
- Use ONLY paths that exist in the provided repository context (themes, modules, file excerpts). Do NOT invent vendor/theme/module names or guess file paths.
- A template (.phtml) renders ONLY when a layout XML block references it. If you create or change a template, you MUST also add/modify the matching layout XML (e.g. <referenceContainer>/<block ... template="Vendor_Module::path.phtml"/>) so the change actually takes effect.
- Edit inside the ACTIVE custom theme or a custom module — never core or vendor code.
- The storefront home page is typically a CMS page (Admin → Content → Pages), not a phtml; do not assume a home.phtml renders unless layout wiring proves it.
- Keep Hyva templates clean; use Tailwind utility classes. Use Magewire only where server-synced interactivity is needed.
- Prefer small, focused changes that satisfy the task and are verifiably wired in.`;

const AGENT_OUTPUT_CONTRACT = `Respond with ONLY a JSON object (no prose, no markdown fences) of this exact shape:
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
- Use repository-relative paths. Only include files you actually change. Never modify a file you have not seen in the provided excerpts unless you are creating it new.`;

function jiraBlock(ctx: PromptContext): string {
  if (!ctx.jira) {
    return ctx.jiraKey ? `Jira task: ${ctx.jiraKey} (details unavailable)` : 'No Jira task linked.';
  }
  const j = ctx.jira;
  return [
    `Jira task: ${j.key} — ${j.summary}`,
    j.issueType ? `Type: ${j.issueType}` : '',
    j.priority ? `Priority: ${j.priority}` : '',
    j.labels.length ? `Labels: ${j.labels.join(', ')}` : '',
    '',
    'Description:',
    j.description || '(none)',
    j.attachments.length
      ? `\nAttachments: ${j.attachments.map((a) => a.filename).join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function repoBlock(ctx: PromptContext): string {
  if (!ctx.repoOverview) return '';
  return `\nRepository map:\n${ctx.repoOverview}`;
}

function excerptsBlock(ctx: PromptContext): string {
  if (!ctx.fileExcerpts?.length) {
    return '\n(No matching existing files were found for this task — inspect the repository map and choose real paths.)';
  }
  return [
    '\nRelevant existing files (read these before deciding what to change):',
    ...ctx.fileExcerpts.map(
      (f) => `\n--- ${f.path} ---\n${f.content.slice(0, 4000)}`,
    ),
  ].join('\n');
}

export function buildPrompt(ctx: PromptContext): { system: string; user: string; jsonMode: boolean } {
  const projectBlock = [
    `Project: ${ctx.project.name}`,
    `Local path: ${ctx.cwd}`,
    ctx.activeTheme ? `Active frontend theme: ${ctx.activeTheme}` : '',
    ctx.frontendUrl ? `Frontend: ${ctx.frontendUrl}` : '',
    ctx.backendUrl ? `Admin: ${ctx.backendUrl}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const userBlock = ctx.userInstructions
    ? `\nDeveloper instructions:\n${ctx.userInstructions}`
    : '';

  const common = `${projectBlock}\n\n${jiraBlock(ctx)}${userBlock}${repoBlock(ctx)}${excerptsBlock(ctx)}`;

  if (ctx.mode === 'agent') {
    if (ctx.priorOutput) {
      const priorFiles = ctx.priorOutput.files
        .map((f) => `- ${f.action}: ${f.path}`)
        .join('\n');
      const refineBlock = `\n\nYou previously proposed this change:\nSummary: ${ctx.priorOutput.summary}\nFiles:\n${priorFiles}\n\nThe developer now requests an ADDITIONAL change on top of that proposal:\n${ctx.refineInstructions ?? ''}\n\nReturn an UPDATED, COMPLETE proposal (include every file that should change, not just the new part), following the same JSON contract and edit rules.`;
      return {
        system: `${MAGENTO_RULES}\n\n${AGENT_OUTPUT_CONTRACT}`,
        user: `Refine the implementation for the following task.\n\n${common}${refineBlock}`,
        jsonMode: true,
      };
    }
    return {
      system: `${MAGENTO_RULES}\n\n${AGENT_OUTPUT_CONTRACT}`,
      user: `Implement the following task.\n\n${common}`,
      jsonMode: true,
    };
  }

  if (ctx.mode === 'plan') {
    return {
      system: `${MAGENTO_RULES}\n\nProduce a clear implementation plan. Do NOT write file contents. Use concise markdown with steps, files to touch, and a test checklist.`,
      user: `Create an implementation plan for this task.\n\n${common}`,
      jsonMode: false,
    };
  }

  if (ctx.mode === 'debug') {
    return {
      system: `${MAGENTO_RULES}\n\nYou are debugging. Analyze the problem, identify likely causes, and propose a minimal fix. Use concise markdown.`,
      user: `Investigate and propose a fix for this issue.\n\n${common}`,
      jsonMode: false,
    };
  }

  // ask
  return {
    system: `${MAGENTO_RULES}\n\nAnswer the question clearly and concisely in markdown.`,
    user: `${common}`,
    jsonMode: false,
  };
}
