const SECTION_HEADER =
  /^(?:#{1,3}\s*)?(acceptance\s*criteria|definition\s*of\s*done|done\s*when|ac)\s*:?\s*$/i;

const BULLET = /^[-*•]\s+(.+)$/;
const NUMBERED = /^\d+[.)]\s+(.+)$/;

/** Next section heading — stops parsing the acceptance block. */
function isNextSection(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/^#{1,3}\s+\S/.test(t)) return true;
  if (SECTION_HEADER.test(t)) return false;
  return /^[A-Z][A-Za-z0-9 /&()-]{0,48}:\s*$/.test(t);
}

/**
 * Pull bullet/numbered acceptance criteria from a Jira or custom task description
 * when a dedicated section heading is present.
 */
export function parseAcceptanceCriteria(text: string | null | undefined): string[] {
  if (!text?.trim()) return [];

  const items: string[] = [];
  let inSection = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (SECTION_HEADER.test(trimmed)) {
      inSection = true;
      continue;
    }

    if (!inSection) continue;

    if (!trimmed) {
      if (items.length > 0) break;
      continue;
    }

    if (isNextSection(trimmed)) break;

    const bullet = trimmed.match(BULLET) ?? trimmed.match(NUMBERED);
    if (bullet) {
      items.push(bullet[1].trim());
    }
  }

  return items;
}

export function resolveAcceptanceCriteria(
  issueDescription?: string | null,
  customRequirements?: string | null,
): string[] {
  const fromIssue = parseAcceptanceCriteria(issueDescription);
  if (fromIssue.length > 0) return fromIssue;
  return parseAcceptanceCriteria(customRequirements);
}
