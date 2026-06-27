import { useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { RunDetail } from '@cpwork/shared';
import { Loader2, RefreshCw } from 'lucide-react';
import { getApiErrorMessage } from '../../lib/api';
import { regenerateRequirementAnalysis } from '../../lib/regenerateRequirementAnalysis';
import { artifactsMatchTask } from '../../lib/workflowTaskMatch';
import { useWorkflowBusy } from '../../context/WorkflowBusyContext';
import { RequirementAnalysisView } from './WorkflowArtifacts';
import { taskBtnGhost, taskMuted } from './taskStyles';

interface RequirementAnalysisSectionProps {
  detail: RunDetail;
  onChange: (d: RunDetail) => void;
  onError: (message: string) => void;
  /** When true, parent page auto-regenerates stale analysis (avoid duplicate calls). */
  autoRegenerateStale?: boolean;
}

export function RequirementAnalysisSection({
  detail,
  onChange,
  onError,
  autoRegenerateStale = false,
}: RequirementAnalysisSectionProps) {
  const stale = !artifactsMatchTask(detail);
  const autoAttemptedRef = useRef<string | null>(null);
  const hasAnalysis = !!detail.workflow?.requirementAnalysis;

  const regenM = useMutation({
    mutationFn: () => regenerateRequirementAnalysis(detail.run.id),
    onSuccess: (d) => {
      onChange(d);
      autoAttemptedRef.current = `${detail.run.id}:ok`;
    },
    onError: (err) => onError(getApiErrorMessage(err)),
  });

  useWorkflowBusy(
    'regenerate-analysis',
    regenM.isPending,
    'Regenerating requirement analysis…',
    'Refreshing Jira details and generating a new analysis for this task.',
  );

  useEffect(() => {
    if (!autoRegenerateStale || !stale || !hasAnalysis || regenM.isPending) return;
    const token = `${detail.run.id}:stale`;
    if (autoAttemptedRef.current === token) return;
    autoAttemptedRef.current = token;
    regenM.mutate();
  }, [autoRegenerateStale, stale, hasAnalysis, detail.run.id, regenM.isPending, regenM]);

  if (!hasAnalysis && !regenM.isPending) return null;

  return (
    <div className="mt-4 space-y-2">
      {stale && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          <p>
            {regenM.isPending
              ? 'Replacing requirement analysis from an older task…'
              : 'This requirement analysis looks like it belongs to a different task.'}
          </p>
          {!regenM.isPending && (
            <button
              type="button"
              className={`${taskBtnGhost} inline-flex items-center gap-1.5 text-amber-100 hover:text-white`}
              onClick={() => regenM.mutate()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Regenerate
            </button>
          )}
        </div>
      )}

      {regenM.isPending && !hasAnalysis ? (
        <p className={`flex items-center gap-2 text-sm ${taskMuted}`}>
          <Loader2 className="h-4 w-4 animate-spin" />
          Generating requirement analysis…
        </p>
      ) : (
        <RequirementAnalysisView
          analysis={detail.workflow?.requirementAnalysis}
          defaultOpen
          onRegenerate={hasAnalysis ? () => regenM.mutate() : undefined}
          regenerating={regenM.isPending}
        />
      )}
    </div>
  );
}
