import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { RunDetail } from '@cpwork/shared';
import { ArrowRight, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { api, getApiErrorMessage } from '../../lib/api';
import { runAgentAndPoll } from '../../lib/runAgentPipeline';
import { regenerateRequirementAnalysis } from '../../lib/regenerateRequirementAnalysis';
import { regenerateTestCases } from '../../lib/regenerateTestCases';
import { useWorkflowBusy } from '../../context/WorkflowBusyContext';
import { workflowArtifactsStale } from '../../lib/workflowTaskMatch';
import { ArtifactViewModal } from './ArtifactViewModal';
import type { WorkflowTab } from './WorkflowTabs';
import {
  AiReviewReportView,
  ArchitectureDesignBody,
  DevelopmentPlanBody,
  RequirementAnalysisBody,
  TestCasesBody,
} from './WorkflowArtifacts';
import {
  taskAccent,
  taskAccentHover,
  taskBtnPrimary,
  taskMuted,
  taskPanel,
  taskStrong,
  taskTitle,
} from './taskStyles';

type ArtifactKey = 'analysis' | 'architecture' | 'plan' | 'tests';

const ARTIFACT_TITLES: Record<ArtifactKey, string> = {
  analysis: 'Requirement Analysis',
  architecture: 'Architecture Design',
  plan: 'Development Plan',
  tests: 'Test Cases',
};

interface PreDevApprovalPanelProps {
  detail: RunDetail;
  onChange: (d: RunDetail) => void;
  onWorkflowTabChange: (tab: WorkflowTab) => void;
  onError?: (message: string) => void;
  onCodeGenPending?: (pending: boolean) => void;
  onInterimDetail?: (d: RunDetail) => void;
}

export function PreDevApprovalPanel({
  detail,
  onChange,
  onWorkflowTabChange,
  onError,
  onCodeGenPending,
  onInterimDetail,
}: PreDevApprovalPanelProps) {
  const wf = detail.workflow!;
  const staleArtifacts = workflowArtifactsStale(detail);
  const [openArtifact, setOpenArtifact] = useState<ArtifactKey | null>(null);
  const autoGenTestsRef = useRef<string | null>(null);

  const regenAnalysisM = useMutation({
    mutationFn: () => regenerateRequirementAnalysis(detail.run.id),
    onSuccess: (d) => onChange(d),
    onError: (err) => onError?.(getApiErrorMessage(err)),
  });

  const regenTestsM = useMutation({
    mutationFn: () => regenerateTestCases(detail.run.id),
    onSuccess: (d) => onChange(d),
    onError: (err) => onError?.(getApiErrorMessage(err)),
  });

  const approveAndRunM = useMutation({
    mutationFn: async () => {
      const runId = detail.run.id;
      const approved = (
        await api.post<{ detail: RunDetail }>(`/workflow/runs/${runId}/approve-pre-dev`)
      ).data.detail;
      onInterimDetail?.(approved);
      return runAgentAndPoll(runId);
    },
    onMutate: () => {
      onCodeGenPending?.(true);
      onWorkflowTabChange('code');
    },
    onSuccess: (d) => {
      onChange(d);
      onWorkflowTabChange('code');
    },
    onSettled: () => onCodeGenPending?.(false),
    onError: (err) => onError?.(getApiErrorMessage(err)),
  });

  useWorkflowBusy(
    'regenerate-analysis-plan',
    regenAnalysisM.isPending,
    'Regenerating requirement analysis…',
    'Clearing outdated artifacts and generating fresh requirements for this task.',
  );

  useWorkflowBusy(
    'regenerate-test-cases',
    regenTestsM.isPending,
    'Generating test cases…',
    'Creating functional, UI, and regression test cases from the development plan.',
  );

  useWorkflowBusy(
    'approve-and-run-agent',
    approveAndRunM.isPending,
    'Generating code…',
    'Approving plan and starting the Developer Agent — may take several minutes.',
  );

  useEffect(() => {
    if (wf.testCases?.length || !wf.planMarkdown || regenTestsM.isPending) return;
    const token = `${detail.run.id}:tests`;
    if (autoGenTestsRef.current === token) return;
    autoGenTestsRef.current = token;
    regenTestsM.mutate();
  }, [detail.run.id, wf.planMarkdown, wf.testCases?.length, regenTestsM.isPending]);

  const ready =
    !!wf.requirementAnalysis &&
    !!wf.architectureDesign &&
    !!wf.planMarkdown &&
    !!(wf.testCases?.length);

  const checklist: { key: ArtifactKey; label: string; ready: boolean }[] = [
    { key: 'analysis', label: 'Requirement Analysis', ready: !!wf.requirementAnalysis },
    { key: 'architecture', label: 'Architecture Design', ready: !!wf.architectureDesign },
    { key: 'plan', label: 'Development Plan', ready: !!wf.planMarkdown },
    { key: 'tests', label: 'Test Cases', ready: !!(wf.testCases?.length) },
  ];

  function renderModalContent() {
    switch (openArtifact) {
      case 'analysis':
        return wf.requirementAnalysis ? (
          <RequirementAnalysisBody analysis={wf.requirementAnalysis} />
        ) : null;
      case 'architecture':
        return wf.architectureDesign ? (
          <ArchitectureDesignBody design={wf.architectureDesign} />
        ) : null;
      case 'plan':
        return (
          <DevelopmentPlanBody planMarkdown={wf.planMarkdown} planTasks={wf.planTasks} />
        );
      case 'tests':
        return wf.testCases?.length ? <TestCasesBody testCases={wf.testCases} /> : null;
      default:
        return null;
    }
  }

  return (
    <div className="space-y-4">
      <div className={taskPanel}>
        <div className="border-b border-slate-700/50 px-4 py-3">
          <h3 className={taskTitle}>Plan &amp; approval</h3>
          <p className={`mt-1 text-sm ${taskMuted}`}>
            Review architecture, development plan, and test cases — then approve to start coding.
          </p>
        </div>
        <ul className="divide-y divide-slate-700/40 px-4 py-2">
          {checklist.map(({ key, label, ready: itemReady }) => (
            <li key={key} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div className="flex min-w-0 items-center gap-2">
                {itemReady ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
                ) : (
                  <span className="h-4 w-4 shrink-0 rounded-full border border-slate-600" />
                )}
                <span className={itemReady ? taskStrong : taskMuted}>{label}</span>
              </div>
              {itemReady ? (
                <div className="flex shrink-0 items-center gap-2">
                  {key === 'analysis' && (
                    <button
                      type="button"
                      className={`inline-flex items-center gap-1 text-xs font-medium ${taskAccent} ${taskAccentHover}`}
                      disabled={regenAnalysisM.isPending}
                      onClick={() => regenAnalysisM.mutate()}
                    >
                      {regenAnalysisM.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      Regenerate
                    </button>
                  )}
                  {key === 'tests' && (
                    <button
                      type="button"
                      className={`inline-flex items-center gap-1 text-xs font-medium ${taskAccent} ${taskAccentHover}`}
                      disabled={regenTestsM.isPending}
                      onClick={() => regenTestsM.mutate()}
                    >
                      {regenTestsM.isPending ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3 w-3" />
                      )}
                      Regenerate
                    </button>
                  )}
                  <button
                    type="button"
                    className={`text-xs font-medium ${taskAccent} ${taskAccentHover} underline-offset-2 hover:underline`}
                    onClick={() => setOpenArtifact(key)}
                  >
                    View
                  </button>
                </div>
              ) : key === 'tests' ? (
                <button
                  type="button"
                  className={`inline-flex shrink-0 items-center gap-1 text-xs font-medium ${taskAccent} ${taskAccentHover}`}
                  disabled={regenTestsM.isPending || !wf.planMarkdown}
                  onClick={() => regenTestsM.mutate()}
                >
                  {regenTestsM.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3 w-3" />
                  )}
                  Generate
                </button>
              ) : (
                <span className={`shrink-0 text-xs ${taskMuted}`}>—</span>
              )}
            </li>
          ))}
        </ul>
        {staleArtifacts && (
          <p className="border-t border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            {regenAnalysisM.isPending
              ? 'Regenerating requirement analysis for this task…'
              : 'Some artifacts may be from a different task. Use Regenerate on Requirement Analysis or go back to Requirements.'}
          </p>
        )}
      </div>

      <ArtifactViewModal
        open={openArtifact !== null}
        title={openArtifact ? ARTIFACT_TITLES[openArtifact] : ''}
        onClose={() => setOpenArtifact(null)}
      >
        {renderModalContent()}
      </ArtifactViewModal>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          className={taskBtnPrimary}
          disabled={!ready || approveAndRunM.isPending || staleArtifacts}
          onClick={() => approveAndRunM.mutate()}
        >
          {approveAndRunM.isPending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Generating code…
            </>
          ) : (
            <>
              Approve &amp; start development
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </button>
      </div>
      {regenTestsM.isError && (
        <p className="text-sm text-red-300">{getApiErrorMessage(regenTestsM.error)}</p>
      )}
      {approveAndRunM.isError && (
        <p className="text-sm text-red-300">{getApiErrorMessage(approveAndRunM.error)}</p>
      )}
    </div>
  );
}

export { AiReviewReportView };
