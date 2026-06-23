import type {
  AgentOutput,
  AiUsage,
  FileDiff,
  GitInfo,
  TestReport,
} from '@cpwork/shared';
import { runsRepo } from '../../db/repositories/runs.js';

import type { FileBackup } from '../git/git.service.js';

export interface StoredDetail {
  output: AgentOutput | null;
  diffs: FileDiff[];
  applied: boolean;
  test: TestReport | null;
  git: GitInfo | null;
  usage: AiUsage | null;
  /** Pre-apply snapshots used to revert working-tree changes. */
  backups: FileBackup[];
  planFilePath?: string | null;
}

const EMPTY: StoredDetail = {
  output: null,
  diffs: [],
  applied: false,
  test: null,
  git: null,
  usage: null,
  backups: [],
};

export function loadDetail(runId: string): StoredDetail {
  const json = runsRepo.getDetailJson(runId);
  if (!json) return { ...EMPTY };
  try {
    return { ...EMPTY, ...JSON.parse(json) };
  } catch {
    return { ...EMPTY };
  }
}

export function saveDetail(runId: string, detail: StoredDetail): void {
  runsRepo.setDetailJson(runId, JSON.stringify(detail));
}

export function patchDetail(runId: string, patch: Partial<StoredDetail>): StoredDetail {
  const current = loadDetail(runId);
  const next = { ...current, ...patch };
  saveDetail(runId, next);
  return next;
}
