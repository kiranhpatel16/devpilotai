import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { AiProviderInfo, DevAgentId, Project, RunDetail } from '@cpwork/shared';
import { getApiErrorMessage } from '../../lib/api';
import { getCodingLlm, getPlanningLlm } from '../../lib/effectiveLlm';
import { advancePreDevPipeline } from '../../lib/workflowAdvance';
import { useWorkflowBusy } from '../../context/WorkflowBusyContext';
import { migrateStep } from '../task-workflow/constants';

const DEV_AGENTS = [
  { id: 'magento' as const, label: 'Magento Developer' },
  { id: 'react' as const, label: 'React Developer' },
  { id: 'laravel' as const, label: 'Laravel Developer' },
  { id: 'qa' as const, label: 'QA Engineer' },
];
import { BranchSetupPanel } from './BranchSetupPanel';
import { taskMuted, taskSurface, taskTitle } from './taskStyles';
import type { WorkflowTab } from './WorkflowTabs';

interface SetupStepPanelProps {
  detail: RunDetail;
  project: Project;
  providers: AiProviderInfo[];
  onChange: (d: RunDetail) => void;
  onWorkflowTabChange: (tab: WorkflowTab) => void;
  onError: (message: string) => void;
}

export function SetupStepPanel({
  detail,
  project,
  providers,
  onChange,
  onWorkflowTabChange,
  onError,
}: SetupStepPanelProps) {
  const wf = detail?.workflow;
  const taskKey = detail?.run.jiraKey ?? '';
  const [branchName, setBranchName] = useState(detail?.run.branchName ?? taskKey);
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
  const [devAgentId, setDevAgentId] = useState<DevAgentId>(wf?.devAgentId ?? 'magento');

  useEffect(() => {
    if (!detail) return;
    setBranchName(detail.run.branchName ?? taskKey);
    const planning = getPlanningLlm(detail, project, providers);
    const coding = getCodingLlm(detail, project, providers);
    setPlanningProvider(planning.provider ?? providers[0]?.id ?? '');
    setPlanningModel(planning.model ?? '');
    setCodingProvider(coding.provider ?? providers[0]?.id ?? '');
    setCodingModel(coding.model ?? '');
    setDevAgentId(wf?.devAgentId ?? 'magento');
  }, [detail?.run.id, taskKey, providers, wf?.devAgentId, project]);

  const continueM = useMutation({
    mutationFn: async () => {
      if (!detail) throw new Error('Start the task first.');
      return advancePreDevPipeline(detail, {
        branchName: branchName.trim(),
        provider: planningProvider || null,
        model: planningModel || null,
        codingProvider: codingProvider || null,
        codingModel: codingModel || null,
        userInstructions: detail.run.userInstructions,
        devAgentId,
      });
    },
    onSuccess: (d) => {
      onChange(d);
      onWorkflowTabChange('plan');
    },
    onError: (err) => onError(getApiErrorMessage(err)),
  });

  useWorkflowBusy(
    'pre-dev-pipeline',
    continueM.isPending,
    'Generating workflow artifacts…',
    'Analysis, architecture, plan, and test cases — may take several minutes.',
  );

  const canContinue =
    !!detail &&
    !!branchName.trim() &&
    !!planningProvider &&
    !!codingProvider &&
    !continueM.isPending;

  if (!detail) {
    return <p className={`text-sm ${taskMuted}`}>Start the task from Requirements.</p>;
  }

  const step = wf?.currentStep ? migrateStep(wf.currentStep) : 'select';
  const setupDone = step !== 'environment_setup' && step !== 'requirement_analysis' && step !== 'select';

  return (
    <div className="space-y-4">
      <div className={`${taskSurface} px-4 py-3`}>
        <h3 className={taskTitle}>Environment &amp; AI setup</h3>
        <p className={`mt-1 text-sm ${taskMuted}`}>
          Choose separate models for planning and code generation, then continue to architecture and
          plan.
        </p>
      </div>

      {providers.length > 0 && (
        <BranchSetupPanel
          project={project}
          providers={providers}
          branchName={branchName}
          planningProvider={planningProvider}
          planningModel={planningModel}
          codingProvider={codingProvider}
          codingModel={codingModel}
          devAgentId={devAgentId}
          devAgents={DEV_AGENTS}
          onBranchNameChange={setBranchName}
          onPlanningProviderChange={setPlanningProvider}
          onPlanningModelChange={setPlanningModel}
          onCodingProviderChange={setCodingProvider}
          onCodingModelChange={setCodingModel}
          onDevAgentChange={setDevAgentId}
          readOnly={setupDone && continueM.isSuccess}
        />
      )}

      {setupDone && !detail.workflow?.testCases?.length && (
        <p className={`text-sm ${taskMuted}`}>
          Setup saved. Continue to generate architecture, plan, and test cases.
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          className="btn-primary"
          disabled={!canContinue}
          onClick={() => continueM.mutate()}
        >
          {continueM.isPending ? 'Generating…' : 'Continue to plan →'}
        </button>
      </div>
    </div>
  );
}
