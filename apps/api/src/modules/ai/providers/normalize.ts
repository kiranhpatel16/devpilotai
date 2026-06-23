import type {
  AgentOutput,
  FileChangeAction,
  FileEdit,
  ProposedFileChange,
} from '@cpwork/shared';

/** Strip ```json fences and locate the outermost JSON object. */
function extractJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

function asAction(value: unknown): FileChangeAction {
  return value === 'create' || value === 'delete' ? value : 'modify';
}

function asEdits(value: unknown): FileEdit[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const edits = value
    .filter(
      (e: any) =>
        e && typeof e.oldString === 'string' && typeof e.newString === 'string',
    )
    .map((e: any) => ({
      oldString: e.oldString as string,
      newString: e.newString as string,
      replaceAll: !!e.replaceAll,
    }));
  return edits.length ? edits : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === 'string' ? v : String(v))).filter(Boolean);
}

/**
 * Parse a model response into a normalized AgentOutput.
 * `text` keeps the raw answer for plan/ask/debug modes.
 */
export function normalizeAgentOutput(raw: string): AgentOutput {
  const text = raw.trim();
  const json = extractJson(raw);

  if (!json) {
    return { summary: '', files: [], manualTestChecklist: [], risks: [], text };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { summary: '', files: [], manualTestChecklist: [], risks: [], text };
  }

  const files: ProposedFileChange[] = Array.isArray(parsed.files)
    ? parsed.files
        .filter((f: any) => f && typeof f.path === 'string')
        .map((f: any) => ({
          path: f.path,
          action: asAction(f.action),
          reason: typeof f.reason === 'string' ? f.reason : null,
          content: typeof f.content === 'string' ? f.content : null,
          edits: asEdits(f.edits),
        }))
    : [];

  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    files,
    manualTestChecklist: asStringArray(parsed.manualTestChecklist),
    risks: asStringArray(parsed.risks),
    text,
  };
}
