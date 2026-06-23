import { HttpError } from '../../../lib/httpError.js';
import type {
  AiAdapter,
  CompletionRequest,
  CompletionResult,
  ProviderCreds,
} from './types.js';

const FALLBACK_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Adapter for Google Gemini (Generative Language API, API-key auth). */
export const geminiAdapter: AiAdapter = {
  id: 'cloud_ai',

  async chat(creds: ProviderCreds, req: CompletionRequest): Promise<CompletionResult> {
    const base = (creds.baseUrl || FALLBACK_BASE).replace(/\/+$/, '');
    const url = `${base}/models/${encodeURIComponent(req.model)}:generateContent?key=${creds.apiKey}`;

    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: [{ text: req.user }] }],
      generationConfig: {
        temperature: 0.2,
        ...(req.jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    };

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new HttpError(502, 'Could not reach Gemini API', 'ai_unreachable', {
        cause: err instanceof Error ? err.message : String(err),
      });
    }
    if (res.status === 401 || res.status === 403) {
      throw new HttpError(502, 'Gemini authentication failed. Check the API key.', 'ai_auth_failed');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new HttpError(502, `Gemini request failed (${res.status})`, 'ai_error', {
        body: text.slice(0, 600),
      });
    }
    const data: any = await res.json();
    const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
    const content = parts.map((p) => p?.text ?? '').join('');
    return {
      content,
      inputTokens: data?.usageMetadata?.promptTokenCount ?? null,
      outputTokens: data?.usageMetadata?.candidatesTokenCount ?? null,
    };
  },

  async verify(creds: ProviderCreds): Promise<void> {
    await this.chat(creds, {
      system: 'ping',
      user: 'ping',
      model: creds.defaultModel || 'gemini-2.0-flash',
      jsonMode: false,
    });
  },
};
