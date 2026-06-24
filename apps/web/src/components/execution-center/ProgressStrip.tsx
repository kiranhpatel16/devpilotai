import type { RunDetail } from '@cpwork/shared';
import { taskMuted } from './taskStyles';

interface ProgressStripProps {
  detail?: RunDetail | null;
  preStart?: boolean;
}

function computeProgress(detail: RunDetail | null | undefined, preStart?: boolean): number {
  if (preStart || !detail?.workflow) return 0;
  const total = 11;
  return Math.min(100, Math.round((detail.workflow.completedSteps.length / total) * 100));
}

export function ProgressStrip({ detail, preStart }: ProgressStripProps) {
  const pct = computeProgress(detail, preStart);
  const started = detail?.run.createdAt;
  const elapsed = started
    ? Math.max(1, Math.round((Date.now() - new Date(started).getTime()) / 60_000))
    : 0;

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-700/60 bg-[#0f0f1a] px-3 py-2 text-xs">
      <div className="flex min-w-[120px] flex-1 items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-700">
          <div
            className="h-full rounded-full bg-brand-600 transition-all"
            style={{ width: `${Math.max(pct, 2)}%` }}
          />
        </div>
        <span className="font-medium text-white">{pct}%</span>
      </div>
      <span className={taskMuted}>
        Elapsed <span className="text-slate-200">{elapsed}m</span>
      </span>
      {detail?.run.provider && (
        <span className={taskMuted}>
          {detail.run.provider}
          {detail.run.model ? ` · ${detail.run.model}` : ''}
        </span>
      )}
    </div>
  );
}
