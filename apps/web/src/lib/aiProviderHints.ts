import type { AiProviderInfo } from '@cpwork/shared';

/** Models recommended for Magento code generation (layout XML, phtml, PHP). */
export const RECOMMENDED_CODE_MODELS = new Set(['gpt-4o', 'gpt-4.1', 'gpt-5', 'gpt-5.4']);

export function isRecommendedCodeModel(model: string): boolean {
  return RECOMMENDED_CODE_MODELS.has(model);
}

export function providerSetupHint(
  providerId: string,
  model: string,
  providers: AiProviderInfo[],
): string | null {
  if (providerId === 'cursor') {
    return 'Cursor SDK is optional and not wired in this build. Use ChatGPT (gpt-4o) here for plan and code; use Cursor IDE manually on the Review step for layout/XML fixes.';
  }
  const p = providers.find((x) => x.id === providerId);
  if (!p?.enabled) return null;
  if (providerId === 'openai' && model && !isRecommendedCodeModel(model)) {
    return 'For theme/layout/XML work, gpt-4o or gpt-4.1 gives fewer mistakes than mini models.';
  }
  if (providerId === 'openai' && isRecommendedCodeModel(model)) {
    return 'Good choice for Magento code — review layout XML diffs before Apply; fix edge cases in Cursor IDE if needed.';
  }
  return null;
}
