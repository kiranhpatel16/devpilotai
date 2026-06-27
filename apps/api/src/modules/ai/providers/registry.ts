import type { AiProviderId, AiProviderInfo } from '@cpwork/shared';
import { HttpError } from '../../../lib/httpError.js';
import { decryptSecret } from '../../../lib/crypto.js';
import { aiSettingsRepo } from '../../../db/repositories/aiSettings.js';
import { PROVIDER_CATALOG, PROVIDER_IDS } from './catalog.js';
import { makeOpenAiCompatibleAdapter } from './openaiCompatible.js';
import { geminiAdapter } from './gemini.js';
import type { AiAdapter, ProviderCreds } from './types.js';

const ADAPTERS: Partial<Record<AiProviderId, AiAdapter>> = {
  openai: makeOpenAiCompatibleAdapter('openai', PROVIDER_CATALOG.openai.defaultBaseUrl!),
  grok: makeOpenAiCompatibleAdapter('grok', PROVIDER_CATALOG.grok.defaultBaseUrl!),
  cloud_ai: geminiAdapter,
  // `cursor` is wired in the Python API (cursor-sdk); not available in the TS API build.
};

export function getAdapter(providerId: AiProviderId): AiAdapter {
  const adapter = ADAPTERS[providerId];
  if (!adapter) {
    throw HttpError.badRequest(
      `Provider "${providerId}" is not available in this build. Use openai, grok, or cloud_ai.`,
    );
  }
  return adapter;
}

/** Build runtime credentials for a provider from stored settings. */
export function resolveCreds(providerId: AiProviderId, modelOverride?: string | null): {
  creds: ProviderCreds;
  model: string;
} {
  const entry = PROVIDER_CATALOG[providerId];
  const setting = aiSettingsRepo.get(providerId);
  if (!setting || !setting.enabled) {
    throw HttpError.badRequest(`Provider "${providerId}" is not enabled. Configure it in Admin → AI Providers.`);
  }
  const apiKey = setting.apiKeyEnc ? decryptSecret(setting.apiKeyEnc) : null;
  if (!apiKey) {
    throw HttpError.badRequest(`Provider "${providerId}" has no valid API key.`);
  }
  const model = modelOverride || setting.defaultModel || entry.defaultModel;
  return {
    creds: {
      apiKey,
      baseUrl: setting.baseUrl,
      defaultModel: setting.defaultModel || entry.defaultModel,
      extra: setting.extra,
    },
    model,
  };
}

/** Public provider info for the admin/user UI (never includes secrets). */
export function listProviderInfo(): AiProviderInfo[] {
  return PROVIDER_IDS.map((id) => {
    const entry = PROVIDER_CATALOG[id];
    const setting = aiSettingsRepo.get(id);
    const available = !!ADAPTERS[id];
    return {
      id,
      label: entry.label,
      enabled: !!setting?.enabled && available,
      configured: !!setting?.apiKeyEnc && available,
      defaultModel: setting?.defaultModel || entry.defaultModel,
      models: entry.models,
      supportsAgent: entry.supportsAgent && available,
    };
  });
}

/** Providers usable right now (enabled + configured + adapter available). */
export function enabledProviderInfo(): AiProviderInfo[] {
  return listProviderInfo().filter((p) => p.enabled && p.configured);
}
