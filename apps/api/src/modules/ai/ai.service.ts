import type { AgentOutput, AiProviderId, AiUsage } from '@cpwork/shared';
import { getAdapter, resolveCreds } from './providers/registry.js';
import { normalizeAgentOutput } from './providers/normalize.js';
import { buildPrompt, type PromptContext } from './prompt.js';

export interface AiRunResult {
  output: AgentOutput;
  usage: AiUsage;
}

export async function runAi(
  providerId: AiProviderId,
  modelOverride: string | null,
  ctx: PromptContext,
): Promise<AiRunResult> {
  const { creds, model } = resolveCreds(providerId, modelOverride);
  const adapter = getAdapter(providerId);
  const prompt = buildPrompt(ctx);

  const started = Date.now();
  const result = await adapter.chat(creds, {
    system: prompt.system,
    user: prompt.user,
    model,
    jsonMode: prompt.jsonMode,
  });
  const latencyMs = Date.now() - started;

  const output = normalizeAgentOutput(result.content);

  return {
    output,
    usage: {
      provider: providerId,
      model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      latencyMs,
    },
  };
}
