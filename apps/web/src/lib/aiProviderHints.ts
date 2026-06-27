import type { AiProviderInfo } from '@cpwork/shared';

/** Models recommended for Magento code generation (layout XML, phtml, PHP). */
export const RECOMMENDED_CODE_MODELS = new Set(['gpt-4o', 'gpt-4.1', 'gpt-5', 'gpt-5.4', 'composer-2.5']);

export function isRecommendedCodeModel(model: string): boolean {
  return RECOMMENDED_CODE_MODELS.has(model);
}

export function providerSetupHint(
  providerId: string,
  model: string,
  providers: AiProviderInfo[],
  purpose: 'planning' | 'coding' = 'coding',
): string | null {
  if (purpose === 'coding' && providerId === 'cursor') {
    return 'Best for the Coding step — runs a local Cursor agent against the project path. Use ChatGPT or Cloud AI for plan and review steps.';
  }
  if (purpose === 'planning' && providerId === 'cursor') {
    return 'Cursor SDK is tuned for file edits. Prefer ChatGPT or Cloud AI for requirement analysis and planning.';
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
