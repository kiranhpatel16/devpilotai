import { CheckCircle2, Loader2 } from 'lucide-react';
import type { AgentGenerationProgress, RunDetail } from '@cpwork/shared';
import { formatUsageTotals } from '../../lib/aiUsageFormat';
import { FilesChangedPanel } from './FilesChangedPanel';
import {
  taskBody,
  taskMuted,
  taskPanel,
  taskStrong,
  taskSurface,
  taskTitle,
} from './taskStyles';

interface CodeGenerationProgressPanelProps {
  detail: RunDetail;
  generation: AgentGenerationProgress | null | undefined;
  providerLabel: string;
  modelLabel: string;
}

export function CodeGenerationProgressPanel({
  detail,
  generation,
  providerLabel,
  modelLabel,
}: CodeGenerationProgressPanelProps) {
  const chunks = generation?.chunks ?? [];
  const current = generation?.currentChunk ?? 0;
  const total = generation?.totalChunks ?? chunks.length;
  const filesGenerated = generation?.filesGenerated ?? detail.output?.files?.length ?? 0;
  const label = generation?.chunkLabel ?? 'Starting…';
  const hasPartialOutput = !!(detail.output?.files?.length);
  const usageFmt = formatUsageTotals(detail.usageTotals);

  return (
    <div className="space-y-4">
      <div className={`${taskSurface} px-4 py-4`}>
        <div className="flex items-start gap-3">
          <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-brand-400" />
          <div className="min-w-0 flex-1 space-y-2">
            <h3 className={taskTitle}>Generating code…</h3>
            <p className={`text-sm ${taskBody}`}>
              The Developer Agent is implementing your approved plan. Stay on this tab to watch
              progress — large tasks are split into parts when the model hits token limits.
            </p>
            <p className={`text-xs ${taskMuted}`}>
              Branch <span className={taskStrong}>{detail.run.branchName || '—'}</span>
              {' · '}
              {providerLabel} ({modelLabel})
              {total > 0 && (
                <>
                  {' · '}
                  Part {Math.min(current, total)} of {total}
                </>
              )}
              {' · '}
              {filesGenerated} file(s) so far
            </p>
            {label && (
              <p className={`text-xs font-medium text-brand-300 dark:text-brand-400`}>{label}</p>
            )}
            {(detail.usageTotals?.callCount ?? 0) > 0 && (
              <p className={`text-xs ${taskMuted}`}>
                Tokens: <span className={taskStrong}>{usageFmt.tokensLine}</span>
                {' · '}
                Cost: <span className="font-medium text-brand-300 dark:text-brand-400">{usageFmt.creditsLine}</span>
                {' · '}
                {usageFmt.callsLine}
              </p>
            )}
          </div>
        </div>
      </div>

      {chunks.length > 0 && (
        <div className={taskPanel}>
          <div className="border-b border-slate-700/50 px-4 py-3">
            <h4 className={`text-sm font-semibold ${taskTitle}`}>Generation parts</h4>
            <p className={`mt-0.5 text-xs ${taskMuted}`}>
              Each part covers a slice of the development plan. Parts continue automatically if
              output is truncated.
            </p>
          </div>
          <ul className="divide-y divide-slate-700/40 px-4 py-2">
            {chunks.map((chunk) => (
              <li key={chunk.index} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div className="flex min-w-0 items-center gap-2">
                  {chunk.status === 'complete' ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                  ) : chunk.status === 'running' ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand-400" />
                  ) : (
                    <span className="h-4 w-4 shrink-0 rounded-full border border-slate-600" />
                  )}
                  <span className={chunk.status === 'pending' ? taskMuted : taskStrong}>
                    {chunk.label}
                  </span>
                </div>
                <span className={`shrink-0 text-xs ${taskMuted}`}>
                  {chunk.status === 'complete' && chunk.fileCount != null
                    ? `${chunk.fileCount} file(s)`
                    : chunk.status === 'running'
                      ? 'In progress…'
                      : 'Pending'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasPartialOutput && (
        <FilesChangedPanel detail={detail} title="Generated so far" />
      )}
    </div>
  );
}
