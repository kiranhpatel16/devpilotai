import type { AiProviderId } from '@cpwork/shared';
import { HttpError } from '../../../lib/httpError.js';
import type {
  AiAdapter,
  CompletionRequest,
  CompletionResult,
  ProviderCreds,
} from './types.js';

/**
 * Adapter for OpenAI-compatible chat completion APIs.
 * Used for both OpenAI (ChatGPT) and xAI (Grok).
 */
export function makeOpenAiCompatibleAdapter(
  id: AiProviderId,
  fallbackBaseUrl: string,
): AiAdapter {
  function base(creds: ProviderCreds): string {
    return (creds.baseUrl || fallbackBaseUrl).replace(/\/+$/, '');
  }

  async function call(
    creds: ProviderCreds,
    body: Record<string, unknown>,
  ): Promise<any> {
    let res: Response;
    try {
      res = await fetch(`${base(creds)}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${creds.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new HttpError(502, `Could not reach ${id} API`, 'ai_unreachable', {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    if (res.status === 401 || res.status === 403) {
      throw new HttpError(502, `${id} authentication failed. Check the API key.`, 'ai_auth_failed');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new HttpError(502, `${id} request failed (${res.status})`, 'ai_error', {
        body: text.slice(0, 600),
      });
    }
    return res.json();
  }

  return {
    id,
    async chat(creds: ProviderCreds, req: CompletionRequest): Promise<CompletionResult> {
      const body: Record<string, unknown> = {
        model: req.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        temperature: 0.2,
      };
      if (req.jsonMode) {
        body.response_format = { type: 'json_object' };
      }
      const data = await call(creds, body);
      const content: string = data?.choices?.[0]?.message?.content ?? '';
      return {
        content,
        inputTokens: data?.usage?.prompt_tokens ?? null,
        outputTokens: data?.usage?.completion_tokens ?? null,
      };
    },
    async verify(creds: ProviderCreds): Promise<void> {
      await call(creds, {
        model: creds.defaultModel || 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      });
    },
  };
}
