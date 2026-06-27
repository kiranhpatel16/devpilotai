import type { AiProviderInfo, Project, RunDetail, TaskWorkflowStep } from '@cpwork/shared';
import { migrateStep } from '../components/task-workflow/constants';

export interface LlmSelection {
  provider: string | null;
  model: string | null;
}

const CODING_STEPS = new Set<TaskWorkflowStep>(['agent', 'deploy', 'code_review', 'commit', 'qa']);

function defaultModel(providers: AiProviderInfo[] | undefined, provider: string | null): string | null {
  if (!provider) return null;
  return providers?.find((p) => p.id === provider)?.defaultModel ?? null;
}

export function getPlanningLlm(
  detail: RunDetail | null | undefined,
  project?: Project | null,
  providers?: AiProviderInfo[],
): LlmSelection {
  if (detail?.effectiveLlm?.planning) {
    return detail.effectiveLlm.planning;
  }

  const llm = project?.llmConfig;
  const locked = detail?.workflow?.llmOverride;

  if (locked) {
    const provider =
      detail?.run.provider ?? llm?.planningProvider ?? llm?.provider ?? providers?.[0]?.id ?? null;
    const model =
      detail?.run.model ??
      llm?.planningModel ??
      llm?.model ??
      defaultModel(providers, provider);
    return { provider, model };
  }

  const provider = llm?.planningProvider ?? llm?.provider ?? detail?.run.provider ?? providers?.[0]?.id ?? null;
  const model =
    llm?.planningModel ??
    llm?.model ??
    detail?.run.model ??
    defaultModel(providers, provider);
  return { provider, model };
}

export function getCodingLlm(
  detail: RunDetail | null | undefined,
  project?: Project | null,
  providers?: AiProviderInfo[],
): LlmSelection {
  if (detail?.effectiveLlm?.coding) {
    return detail.effectiveLlm.coding;
  }

  const llm = project?.llmConfig;
  const wf = detail?.workflow;

  if (wf?.codingProvider) {
    return {
      provider: wf.codingProvider,
      model: wf.codingModel ?? llm?.codingModel ?? defaultModel(providers, wf.codingProvider),
    };
  }

  const cursorAvailable = providers?.some((p) => p.id === 'cursor');
  const provider =
    llm?.codingProvider ??
    (cursorAvailable ? 'cursor' : null) ??
    llm?.planningProvider ??
    llm?.provider ??
    detail?.run.provider ??
    providers?.[0]?.id ??
    null;
  const model =
    llm?.codingModel ??
    (provider === 'cursor' ? 'composer-2.5' : null) ??
    llm?.planningModel ??
    llm?.model ??
    defaultModel(providers, provider);

  return { provider, model };
}

export function getEffectiveLlm(
  detail: RunDetail | null | undefined,
  project?: Project | null,
  providers?: AiProviderInfo[],
  purpose: 'auto' | 'planning' | 'coding' = 'auto',
): LlmSelection & { planning: LlmSelection; coding: LlmSelection } {
  const planning = getPlanningLlm(detail, project, providers);
  const coding = getCodingLlm(detail, project, providers);

  if (purpose === 'planning') {
    return { ...planning, planning, coding };
  }
  if (purpose === 'coding') {
    return { ...coding, planning, coding };
  }

  const step = detail?.workflow?.currentStep ? migrateStep(detail.workflow.currentStep) : null;
  const active = step && CODING_STEPS.has(step) ? coding : planning;
  return { ...active, planning, coding };
}

export function formatLlmLabel(selection: LlmSelection | null | undefined): string {
  if (!selection?.provider && !selection?.model) return '—';
  if (!selection.model) return selection.provider ?? '—';
  return `${selection.provider} · ${selection.model}`;
}

export function formatEffectiveLlmLabel(
  detail: RunDetail | null | undefined,
  project?: Project | null,
  providers?: AiProviderInfo[],
): string {
  const { planning, coding } = getEffectiveLlm(detail, project, providers);
  if (planning.provider === coding.provider && planning.model === coding.model) {
    return formatLlmLabel(planning);
  }
  return `Plan: ${formatLlmLabel(planning)} · Code: ${formatLlmLabel(coding)}`;
}
