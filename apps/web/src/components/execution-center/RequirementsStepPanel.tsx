import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { AiProviderInfo, JiraIssueDetail, Project, RunDetail } from '@cpwork/shared';
import { ArrowRight, Loader2 } from 'lucide-react';
import { getApiErrorMessage } from '../../lib/api';
import { advanceToPlanAndGenerate, isEarlyWorkflowStep } from '../../lib/workflowAdvance';
import { AcceptanceCriteriaPanel } from './AcceptanceCriteriaPanel';
import { AttachmentsPanel } from './AttachmentsPanel';
import { BranchSetupPanel } from './BranchSetupPanel';
import { ProgressStrip } from './ProgressStrip';
import { loadStoredNotes, RequirementNotesPanel } from './RequirementNotesPanel';
import { TaskDetailsPanel } from './TaskDetailsPanel';
import { taskBtnPrimary, taskInput, taskMuted } from './taskStyles';
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

  const [notes, setNotes] = useState(() =>
    detail?.run.userInstructions ?? loadStoredNotes(taskKey),
  );
  const [branchName, setBranchName] = useState(
    detail?.run.branchName ?? taskKey ?? '',
  );
  const [provider, setProvider] = useState(
    detail?.run.provider ?? providers[0]?.id ?? '',
  );
  const [model, setModel] = useState(detail?.run.model ?? '');

  useEffect(() => {
    if (!detail) return;
    if (detail.run.userInstructions != null) {
      setNotes(detail.run.userInstructions);
    }
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

  const activeProvider = providers.find((p) => p.id === provider) ?? providers[0];
  const canGenerate =
    !!detail &&
    earlyStep &&
    !!branchName.trim() &&
    !!provider &&
    !!(model || activeProvider?.defaultModel);

  return (
    <div className="space-y-4">
      <ProgressStrip detail={detail} preStart={preStart} />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <TaskDetailsPanel
            issue={issue}
            customTitle={customTitle || wf?.customTitle || undefined}
            createdBy={issue?.assignee}
            createdAt={issue?.updated}
            expanded
          />
          <AttachmentsPanel attachments={attachments} />
          <AcceptanceCriteriaPanel />
        </div>

        <div className="space-y-4">
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
            <div className="rounded-lg border border-slate-700/60 bg-[#1a1a2e] p-4">
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

      {preStart && (
        <p className={`text-center text-sm ${taskMuted}`}>
          Use <strong className="text-slate-300">Start Task</strong> in the header to configure
          branch and generate a plan.
        </p>
      )}

      {detail && earlyStep && (
        <div className="flex justify-end border-t border-slate-700/60 pt-4">
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
