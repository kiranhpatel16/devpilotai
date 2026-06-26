import type { AiProviderId } from '@cpwork/shared';
import type { ProviderCatalogEntry } from './types.js';

/** Static provider catalog: labels, endpoints, and model options. */
export const PROVIDER_CATALOG: Record<AiProviderId, ProviderCatalogEntry> = {
  openai: {
    id: 'openai',
    label: 'ChatGPT (OpenAI)',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    models: [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4.1',
      'gpt-4.1-mini',
      'o3-mini',
      'gpt-5',
      'gpt-5-mini',
      'gpt-5.4',
      'gpt-5.5',
      'gpt-5.4-pro',
    ],
    supportsAgent: true,
  },
  grok: {
    id: 'grok',
    label: 'Grok (xAI)',
    defaultBaseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-2-latest',
    models: ['grok-2-latest', 'grok-2', 'grok-beta'],
    supportsAgent: true,
  },
  cloud_ai: {
    id: 'cloud_ai',
    label: 'Cloud AI (Gemini)',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash',
    models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'],
    supportsAgent: true,
  },
  cursor: {
    id: 'cursor',
    label: 'Cursor SDK',
    defaultBaseUrl: null,
    defaultModel: 'composer-2.5',
    models: ['composer-2.5'],
    supportsAgent: true,
  },
};

export const PROVIDER_IDS = Object.keys(PROVIDER_CATALOG) as AiProviderId[];
