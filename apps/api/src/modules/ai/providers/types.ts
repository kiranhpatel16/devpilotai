import type { AiProviderId } from '@cpwork/shared';

export interface ProviderCreds {
  apiKey: string;
  baseUrl: string | null;
  defaultModel: string | null;
  extra: Record<string, unknown>;
}

export interface CompletionRequest {
  system: string;
  user: string;
  model: string;
  /** Ask the provider to return strict JSON when supported. */
  jsonMode: boolean;
}

export interface CompletionResult {
  content: string;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface AiAdapter {
  id: AiProviderId;
  chat(creds: ProviderCreds, req: CompletionRequest): Promise<CompletionResult>;
  /** Lightweight credential check. Throws HttpError on failure. */
  verify(creds: ProviderCreds): Promise<void>;
}

export interface ProviderCatalogEntry {
  id: AiProviderId;
  label: string;
  defaultBaseUrl: string | null;
  defaultModel: string;
  models: string[];
  supportsAgent: boolean;
}
