import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { AiProviderInfo, JiraIssueDetail, Project, RunDetail } from '@cpwork/shared';
import { ArrowRight, Loader2 } from 'lucide-react';
import { getApiErrorMessage } from '../../lib/api';
import { useWorkflowBusy } from '../../context/WorkflowBusyContext';
import { advanceToPlanAndGenerate, isEarlyWorkflowStep } from '../../lib/workflowAdvance';
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
  const setupComplete = !!detail && !earlyStep;

  const [notes, setNotes] = useState(() => {
    if (detail?.run.id) return detail.run.userInstructions ?? '';
    return loadStoredNotes(taskKey);
  });
  const [branchName, setBranchName] = useState(
    detail?.run.branchName ?? taskKey ?? '',
  );
  const [provider, setProvider] = useState(
    detail?.run.provider ?? providers[0]?.id ?? '',
  );
  const [model, setModel] = useState(detail?.run.model ?? '');

  useEffect(() => {
    if (!detail) {
      if (taskKey) setNotes(loadStoredNotes(taskKey));
      return;
    }
    setNotes(detail.run.userInstructions ?? '');
    const p = detail.run.provider ?? providers[0]?.id ?? '';
    setBranchName(detail.run.branchName ?? taskKey ?? '');
    setProvider(p);
    setModel(detail.run.model ?? providers.find((x) => x.id === p)?.defaultModel ?? '');
  }, [detail?.run.id, taskKey, providers]);

  const generateM = useMutation({
    mutationFn: async () => {
      if (!detail) throw new Error('Start the task before generating a plan.');
      return advanceToPlanAndGenerate(detail, {
        branchName: branchName.trim(),
        provider: provider || null,
        model: model || null,
        userInstructions: notes.trim() || null,
      });
    },
    onSuccess: (d) => {
      onChange(d);
      onWorkflowTabChange('plan');
    },
    onError: (err) => onError(getApiErrorMessage(err)),
  });

  useWorkflowBusy('generate-plan', generateM.isPending, 'Generating plan…');

  const activeProvider = providers.find((p) => p.id === provider) ?? providers[0];
  const acceptanceCriteria = resolveAcceptanceCriteria(
    issue?.description,
    wf?.customRequirements,
  );
  const canGenerate =
    !!detail &&
    earlyStep &&
    !!branchName.trim() &&
    !!provider &&
    !!(model || activeProvider?.defaultModel);

  const showGenerateFooter = !!(detail && earlyStep);
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
        <ProgressStrip detail={detail} preStart={preStart} />
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

          {detail && earlyStep && providers.length > 0 && (
            <BranchSetupPanel
              project={project}
              providers={providers}
              branchName={branchName}
              provider={provider}
              model={model || activeProvider?.defaultModel || ''}
              onBranchNameChange={setBranchName}
              onProviderChange={(id) => {
                setProvider(id);
                const next = providers.find((p) => p.id === id);
                setModel(next?.defaultModel ?? '');
              }}
              onModelChange={setModel}
            />
          )}

          {setupComplete && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              Setup complete.{' '}
              <button
                type="button"
                className="font-medium underline hover:text-emerald-100"
                onClick={() => onWorkflowTabChange('plan')}
              >
                View plan →
              </button>
            </div>
          )}
        </div>
      </div>

      {showGenerateFooter && (
        <div className="sticky bottom-0 z-10 mt-1 flex shrink-0 justify-end border-t border-slate-200 bg-white/95 py-3 backdrop-blur-sm dark:border-neutral-800/60 dark:bg-[#0a0a0a]/95">
          <button
            type="button"
            className={taskBtnPrimary}
            disabled={!canGenerate || generateM.isPending}
            onClick={() => generateM.mutate()}
          >
            {generateM.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating plan…
              </>
            ) : (
              <>
                Generate plan
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
