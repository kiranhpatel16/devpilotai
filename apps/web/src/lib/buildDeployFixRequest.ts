import type { DeployFailureAnalysis, RunDetail, TestReport } from '@cpwork/shared';

function failedStepOutput(deploy: TestReport | null): string {
  if (!deploy?.steps?.length) return deploy?.error?.trim() ?? '';
  for (let i = deploy.steps.length - 1; i >= 0; i -= 1) {
    const step = deploy.steps[i];
    if (!step.ok && !step.skipped && step.output?.trim()) {
      return step.output.trim();
    }
  }
  return deploy.error?.trim() ?? '';
}

/** Pre-fill deploy fix instructions from analysis + failed step output. */
export function buildDeployFixRequest(
  analysis: DeployFailureAnalysis | null | undefined,
  deploy: TestReport | null,
  detail?: RunDetail,
): string {
  const lines: string[] = [];

  if (analysis?.summary?.trim()) {
    lines.push(`Fix this deploy failure: ${analysis.summary.trim()}`);
  }
  if (analysis?.failedStep) {
    lines.push(`Failed step: ${analysis.failedStep}`);
  }

  for (const issue of analysis?.issues ?? []) {
    const message = issue.message?.trim();
    if (message) {
      lines.push(`[${issue.kind ?? 'issue'}] ${message}`);
    }
  }

  const rawOutput = failedStepOutput(deploy) || analysis?.rawOutput?.trim() || '';
  if (rawOutput) {
    const excerpt = rawOutput.length > 2500 ? `${rawOutput.slice(0, 2500)}\n…` : rawOutput;
    lines.push(`\nDeploy output excerpt:\n${excerpt}`);
  }

  const changedLayout = (detail?.output?.files ?? [])
    .map((f) => f.path)
    .filter((p) => /\/layout\/.*\.xml$/i.test(p) || p.endsWith('.phtml'));

  const errorFiles = analysis?.errorFiles ?? [];
  const targets = [...new Set([...changedLayout, ...errorFiles])].slice(0, 10);
  if (targets.length > 0) {
    lines.push('\nFiles to inspect and fix:');
    for (const path of targets) {
      lines.push(`- ${path}`);
    }
  }

  const layoutDom = (analysis?.issues ?? []).some((i) => i.kind === 'layout_dom_validation');
  if (layoutDom) {
    lines.push(
      '\nRequired Magento-standard fix:',
      '1. Move inline <script> and <noscript> OUT of layout XML into a .phtml template.',
      '2. Remove invalid tags from layout XML (e.g. default_head_blocks.xml).',
      '3. Add a Template block in head.additional referencing the phtml (same pattern as gtm_head.phtml).',
      '4. Do NOT edit PHP plugin files from the stack trace — preserve all DI and functionality.',
    );
  }

  return lines.join('\n').trim();
}
