import type { RunDetail } from '@cpwork/shared';
import { api, longRequest } from './api';

/** Generate workflow test cases from the approved development plan. */
export async function regenerateTestCases(runId: string): Promise<RunDetail> {
  return (
    await api.post<{ detail: RunDetail }>(
      `/workflow/runs/${runId}/generate-test-cases`,
      undefined,
      longRequest,
    )
  ).data.detail;
}
