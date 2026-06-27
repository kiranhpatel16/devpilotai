import type { RunUsageTotals } from '@cpwork/shared';

/** Format token counts with thousands separators. */
export function formatTokenCount(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toLocaleString();
}

/** Human-readable credits + token summary for workflow UI. */
export function formatUsageTotals(totals: RunUsageTotals | null | undefined): {
  tokensLine: string;
  creditsLine: string;
  callsLine: string;
  latencyLine: string;
} {
  if (!totals || totals.callCount === 0) {
    return {
      tokensLine: '—',
      creditsLine: '—',
      callsLine: '0 calls',
      latencyLine: '—',
    };
  }
  const inp = formatTokenCount(totals.inputTokens);
  const out = formatTokenCount(totals.outputTokens);
  const total = formatTokenCount(totals.totalTokens);
  const credits =
    totals.creditsUsed >= 10
      ? totals.creditsUsed.toFixed(1)
      : totals.creditsUsed.toFixed(2);
  const latencySec =
    totals.latencyMs >= 1000
      ? `${(totals.latencyMs / 1000).toFixed(1)}s`
      : `${totals.latencyMs}ms`;
  return {
    tokensLine: `${inp} in · ${out} out (${total} total)`,
    creditsLine: `${credits} credits`,
    callsLine: `${totals.callCount} AI call${totals.callCount === 1 ? '' : 's'}`,
    latencyLine: latencySec,
  };
}
