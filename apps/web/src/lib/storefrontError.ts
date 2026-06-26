import type { StorefrontError } from '@cpwork/shared';

/** Human-readable summary of a parsed Magento storefront error. */
export function formatStorefrontError(err: StorefrontError): string {
  const lines: string[] = [];
  if (err.type) lines.push(err.type);
  if (err.message) lines.push(err.message);
  if (err.file) {
    lines.push(`File: ${err.file}${err.line ? ` (line ${err.line})` : ''}`);
  }
  for (const d of err.details ?? []) {
    lines.push(`• ${d}`);
  }
  return lines.join('\n');
}

/** Short one-line summary for check list headers. */
export function storefrontErrorSummary(err: StorefrontError): string {
  if (err.file && err.line) {
    return `${err.file} line ${err.line}`;
  }
  if (err.file) return err.file;
  return err.message;
}
