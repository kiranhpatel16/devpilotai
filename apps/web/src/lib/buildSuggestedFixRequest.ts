/** Build refine instructions from blocking issues shown in the Review step. */
export function buildSuggestedFixRequest(
  validationErrors: string[],
  diffErrors: string[],
  _detailError?: string | null,
): string {
  const issues = [...validationErrors, ...diffErrors];
  const blob = issues.join(' ').toLowerCase();

  const instructions: string[] = [];

  const hasLayoutXml = issues.some(
    (e) =>
      /\/layout\/|\/page_layout\/|\.xml:/i.test(e) ||
      /unescaped.*&|invalid xml|entityref/i.test(e),
  );
  const hasStub = /stub|placeholder/.test(blob);
  const hasMissingFile = /file does not exist|must use action=.create/i.test(blob);
  const hasSyntax = /syntax|parse error|php -l|unmatched/.test(blob);

  if (hasLayoutXml) {
    instructions.push(
      'Fix the layout/theme XML validation errors below.',
      'Escape every & as &amp; in XML attributes and URLs.',
      'Return action=modify with the FULL corrected XML file content for each affected layout file.',
    );
  }

  if (hasStub) {
    instructions.push(
      'Replace all stub/placeholder code with full implementations.',
      'New PHPUnit test files must use action=create with full file content.',
    );
  }

  if (hasMissingFile) {
    instructions.push(
      'Files that do not exist yet must use action=create with full content (never modify with edits only).',
    );
  }

  if (hasSyntax) {
    instructions.push(
      'Return action=modify with the FULL corrected PHP file in content (not small edits).',
    );
  }

  if (instructions.length === 0) {
    instructions.push('Fix every quality issue listed below in the current proposal.');
  }

  instructions.push(
    'Keep every file from the current proposal — do not drop implementation files.',
  );

  let text = instructions.join(' ');

  if (issues.length > 0) {
    text += `\n\nIssues to fix:\n${issues.map((e) => `- ${e}`).join('\n')}`;
  }

  return text;
}
