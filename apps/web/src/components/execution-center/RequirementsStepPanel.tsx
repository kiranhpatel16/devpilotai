import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { AiProviderInfo, JiraIssueDetail, Project, RunDetail } from '@cpwork/shared';
import { ArrowRight, Loader2, RefreshCw } from 'lucide-react';
import { getApiErrorMessage } from '../../lib/api';
import { getCodingLlm, getPlanningLlm } from '../../lib/effectiveLlm';
import { regenerateRequirementAnalysis } from '../../lib/regenerateRequirementAnalysis';
import { useWorkflowBusy } from '../../context/WorkflowBusyContext';
import { isEarlyWorkflowStep } from '../../lib/workflowAdvance';
import { artifactsMatchTask } from '../../lib/workflowTaskMatch';
import { migrateStep } from '../task-workflow/constants';
import { resolveAcceptanceCriteria } from '../../lib/parseAcceptanceCriteria';
import { AcceptanceCriteriaPanel } from './AcceptanceCriteriaPanel';
import { AttachmentsPanel } from './AttachmentsPanel';
import { BranchSetupPanel } from './BranchSetupPanel';
import { ProgressStrip } from './ProgressStrip';
import { loadStoredNotes, RequirementNotesPanel } from './RequirementNotesPanel';
import { TaskDetailsPanel } from './TaskDetailsPanel';
import { taskBtnPrimary, taskInput, taskMuted, taskStrong, taskSurface } from './taskStyles';
import type { WorkflowTab } from './WorkflowTabs';

interface RequirementsStepPanelProps {
  detail: RunDetail | null;
  preStart: boolean;
  project: Project;
  providers: AiProviderInfo[];
  issue: JiraIssueDetail | null;
  customTitle: string;
  custom: boolean;
  selectedKey: string | null;
  onChange: (d: RunDetail) => void;
  onCustomTitleChange: (title: string) => void;
  onWorkflowTabChange: (tab: WorkflowTab) => void;
  onError: (message: string) => void;
}

export function RequirementsStepPanel({
  detail,
  preStart,
  project,
  providers,
  issue,
  customTitle,
  custom,
  selectedKey,
  onChange,
  onCustomTitleChange,
  onWorkflowTabChange,
  onError,
}: RequirementsStepPanelProps) {
  const wf = detail?.workflow;
  const taskKey = detail?.run.jiraKey ?? selectedKey;
  const attachments = issue?.attachments ?? wf?.jiraSnapshot?.attachments ?? [];
  const earlyStep = isEarlyWorkflowStep(wf?.currentStep);
  const step = wf ? migrateStep(wf.currentStep) : null;
  const setupComplete = !!detail && step !== 'select' && step !== 'requirement_analysis';

  const [notes, setNotes] = useState(() => {
    if (detail?.run.id) return detail.run.userInstructions ?? '';
    return loadStoredNotes(taskKey);
  });
  const [branchName, setBranchName] = useState(
    detail?.run.branchName ?? taskKey ?? '',
  );
  const [planningProvider, setPlanningProvider] = useState(
    () => getPlanningLlm(detail, project, providers).provider ?? providers[0]?.id ?? '',
  );
  const [planningModel, setPlanningModel] = useState(
    () => getPlanningLlm(detail, project, providers).model ?? '',
  );
  const [codingProvider, setCodingProvider] = useState(
    () => getCodingLlm(detail, project, providers).provider ?? providers[0]?.id ?? '',
  );
  const [codingModel, setCodingModel] = useState(
    () => getCodingLlm(detail, project, providers).model ?? '',
  );

  useEffect(() => {
    if (!detail) {
      setNotes(loadStoredNotes(taskKey));
      return;
    }
    setNotes((prev) => {
      const fromRun = detail.run.userInstructions?.trim();
      if (fromRun) return fromRun;
      if (prev.trim()) return prev;
      return loadStoredNotes(taskKey, detail.run.id);
    });
    const planning = getPlanningLlm(detail, project, providers);
    const coding = getCodingLlm(detail, project, providers);
    setBranchName(detail.run.branchName ?? taskKey ?? '');
    setPlanningProvider(planning.provider ?? providers[0]?.id ?? '');
    setPlanningModel(planning.model ?? '');
    setCodingProvider(coding.provider ?? providers[0]?.id ?? '');
    setCodingModel(coding.model ?? '');
  }, [detail?.run.id, taskKey, providers, project]);

  const generateM = useMutation({
    mutationFn: async () => {
      if (!detail) throw new Error('Start the task before continuing.');
      const runId = detail.run.id;
      const needsAnalysis =
        !detail.workflow?.requirementAnalysis || !artifactsMatchTask(detail);
      if (needsAnalysis) {
        return regenerateRequirementAnalysis(runId);
      }
      return detail;
    },
    onSuccess: (d) => {
      onChange(d);
      onWorkflowTabChange('setup');
    },
    onError: (err) => onError(getApiErrorMessage(err)),
  });

  useWorkflowBusy(
    'generate-analysis',
    generateM.isPending,
    'Analyzing requirements…',
    'Reading task, knowledge base, and codebase to produce requirement analysis.',
  );

  const regenM = useMutation({
    mutationFn: () => {
      if (!detail) throw new Error('Start the task before continuing.');
      return regenerateRequirementAnalysis(detail.run.id);
    },
    onSuccess: (d) => onChange(d),
    onError: (err) => onError(getApiErrorMessage(err)),
  });

  useWorkflowBusy(
    'regenerate-analysis-manual',
    regenM.isPending,
    'Regenerating requirement analysis…',
    'Refreshing Jira details and generating a new analysis for this task.',
  );

  const activePlanningProvider =
    providers.find((p) => p.id === planningProvider) ?? providers[0];
  const acceptanceCriteria = resolveAcceptanceCriteria(
    issue?.description,
    wf?.customRequirements,
  );
  const canGenerate = !!detail && (step === 'select' || step === 'requirement_analysis');
  const hasValidAnalysis =
    !!detail?.workflow?.requirementAnalysis && artifactsMatchTask(detail);
  const staleAnalysis =
    !!detail?.workflow?.requirementAnalysis && !artifactsMatchTask(detail);

  const showGenerateFooter = !!(detail && canGenerate);
  const columnScrollMax = showGenerateFooter
    ? 'lg:max-h-[calc(100vh-21rem)]'
    : 'lg:max-h-[calc(100vh-18rem)]';
  const columnClass = [
    'flex flex-col gap-4',
    columnScrollMax,
    'lg:overflow-y-auto lg:overscroll-y-contain',
    showGenerateFooter ? 'pb-6' : 'pb-4',
  ].join(' ');

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="shrink-0 space-y-2">
        <ProgressStrip detail={detail} preStart={preStart} project={project} providers={providers} />
        {preStart && (
          <p className={`text-sm ${taskMuted}`}>
            Use <strong className={taskStrong}>Start Task</strong> in the header to configure
            branch and generate a plan.
          </p>
        )}
      </div>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-2 lg:items-start">
        <div className={`${columnClass} lg:pr-2`}>
          <TaskDetailsPanel
            issue={issue}
            customTitle={customTitle || wf?.customTitle || undefined}
            customRequirements={wf?.customRequirements || undefined}
            createdBy={issue?.assignee}
            createdAt={issue?.updated}
            expanded
          />
          <AttachmentsPanel attachments={attachments} />
          <AcceptanceCriteriaPanel items={acceptanceCriteria} />
        </div>

        <div className={`${columnClass} lg:pl-2`}>
          <RequirementNotesPanel
            runId={detail?.run.id}
            currentStep={wf?.currentStep}
            value={notes}
            taskKey={taskKey}
            onNotesChange={setNotes}
            onSaved={onChange}
            readOnly={setupComplete}
          />

          {preStart && custom && (
            <div className={`${taskSurface} p-4`}>
              <label className={`label ${taskMuted}`}>Custom task title</label>
              <input
                className={taskInput}
                placeholder="Describe your task…"
                value={customTitle}
                onChange={(e) => onCustomTitleChange(e.target.value)}
              />
            </div>
          )}

          {detail && earlyStep && providers.length > 0 && step === 'environment_setup' && (
            <BranchSetupPanel
              project={project}
              providers={providers}
              branchName={branchName}
              planningProvider={planningProvider}
              planningModel={planningModel || activePlanningProvider?.defaultModel || ''}
              codingProvider={codingProvider}
              codingModel={codingModel}
              onBranchNameChange={setBranchName}
              onPlanningProviderChange={(id) => {
                setPlanningProvider(id);
                const next = providers.find((p) => p.id === id);
                setPlanningModel(next?.defaultModel ?? '');
              }}
              onPlanningModelChange={setPlanningModel}
              onCodingProviderChange={(id) => {
                setCodingProvider(id);
                const next = providers.find((p) => p.id === id);
                setCodingModel(next?.defaultModel ?? '');
              }}
              onCodingModelChange={setCodingModel}
            />
          )}

          {setupComplete && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              Setup complete.{' '}
              <button
                type="button"
                className="font-medium underline hover:text-emerald-100"
                onClick={() => onWorkflowTabChange('setup')}
              >
                Continue to setup →
              </button>
            </div>
          )}
        </div>
      </div>

      {showGenerateFooter && (
        <div className="sticky bottom-0 z-10 mt-1 flex shrink-0 justify-end gap-2 border-t border-slate-200 bg-white/95 py-3 backdrop-blur-sm dark:border-neutral-800/60 dark:bg-[#0a0a0a]/95">
          {hasValidAnalysis && (
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-2"
              disabled={regenM.isPending || generateM.isPending}
              onClick={() => regenM.mutate()}
            >
              {regenM.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Regenerate analysis
            </button>
          )}
          <button
            type="button"
            className={taskBtnPrimary}
            disabled={!canGenerate || generateM.isPending || regenM.isPending || staleAnalysis}
            onClick={() => generateM.mutate()}
          >
            {generateM.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing…
              </>
            ) : hasValidAnalysis ? (
              <>
                Continue to setup
                <ArrowRight className="h-4 w-4" />
              </>
            ) : (
              <>
                Next — requirement analysis
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
