import type { RunDetail } from '@cpwork/shared';
import { api, longRequest } from './api';

/** Clear pre-dev artifacts and generate fresh requirement analysis for the run. */
export async function regenerateRequirementAnalysis(runId: string): Promise<RunDetail> {
  return (
    await api.post<{ detail: RunDetail }>(
      `/workflow/runs/${runId}/generate-analysis`,
      undefined,
      longRequest,
    )
  ).data.detail;
}
