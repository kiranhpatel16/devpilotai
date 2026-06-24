import type {
  Activity,
  AiProviderInfo,
  JiraIssueDetail,
  Project,
  RunDetail,
  TaskWorkflowStep,
} from '@cpwork/shared';
import { WorkflowStepContent } from '../task-workflow/WorkflowStepContent';
import { DeployStepPanel } from './DeployStepPanel';
import { PrStepPanel } from './PrStepPanel';
import { TestsStepPanel } from './TestsStepPanel';
import { FilesChangedPanel } from './FilesChangedPanel';
import { PlanOverviewPanel } from './PlanOverviewPanel';
import { ProgressStrip } from './ProgressStrip';
import { ReviewStepPanel } from './ReviewStepPanel';
import { TaskContextRail } from './TaskContextRail';
import { RequirementsStepPanel } from './RequirementsStepPanel';
import { isEarlyWorkflowStep } from '../../lib/workflowAdvance';
import { taskMuted } from './taskStyles';
import type { WorkflowTab } from './WorkflowTabs';

interface StepContentRouterProps {
  tab: WorkflowTab;
  detail: RunDetail | null;
  preStart: boolean;
  project: Project;
  providers: AiProviderInfo[];
  issue: JiraIssueDetail | null;
  customTitle: string;
  custom: boolean;
  selectedKey: string | null;
  activities: Activity[];
  onChange: (d: RunDetail) => void;
  onNavigate: (step: TaskWorkflowStep) => void;
  onCustomTitleChange: (title: string) => void;
  onWorkflowTabChange: (tab: WorkflowTab) => void;
  onError: (message: string) => void;
}

function WorkflowActions({
  detail,
  project,
  providers,
  onChange,
  onNavigate,
}: {
  detail: RunDetail;
  project: Project;
  providers: AiProviderInfo[];
  onChange: (d: RunDetail) => void;
  onNavigate: (step: TaskWorkflowStep) => void;
}) {
  return (
    <div className="task-workflow-dark">
      <WorkflowStepContent
        detail={detail}
        project={project}
        providers={providers}
        onChange={onChange}
        onNavigate={onNavigate}
        hideSetupSteps
      />
    </div>
  );
}

export function StepContentRouter({
  tab,
  detail,
  preStart,
  project,
  providers,
  issue,
  customTitle,
  custom,
  selectedKey,
  activities,
  onChange,
  onNavigate,
  onCustomTitleChange,
  onWorkflowTabChange,
  onError,
}: StepContentRouterProps) {
  const wf = detail?.workflow;

  switch (tab) {
    case 'requirements':
      return (
        <RequirementsStepPanel
          detail={detail}
          preStart={preStart}
          project={project}
          providers={providers}
          issue={issue}
          customTitle={customTitle}
          custom={custom}
          selectedKey={selectedKey}
          onChange={onChange}
          onCustomTitleChange={onCustomTitleChange}
          onWorkflowTabChange={onWorkflowTabChange}
          onError={onError}
        />
      );

    case 'plan':
      return (
        <div className="space-y-4">
          <ProgressStrip detail={detail} />
          <TaskContextRail
            issue={issue}
            customTitle={customTitle || wf?.customTitle || undefined}
            defaultCollapsed
          />
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <PlanOverviewPanel
              planMarkdown={wf?.planMarkdown ?? null}
              currentStep={wf?.currentStep}
            />
            <div className="min-w-0">
              {detail && wf && !isEarlyWorkflowStep(wf.currentStep) ? (
                <WorkflowActions
                  detail={detail}
                  project={project}
                  providers={providers}
                  onChange={onChange}
                  onNavigate={onNavigate}
                />
              ) : detail && wf && isEarlyWorkflowStep(wf.currentStep) ? (
                <p className={`text-sm ${taskMuted}`}>
                  Go to <strong className="text-slate-300">Requirements</strong>, configure branch
                  &amp; AI, then click <strong className="text-slate-300">Generate plan</strong>.
                </p>
              ) : (
                <p className={`text-sm ${taskMuted}`}>Start the task to generate a plan.</p>
              )}
            </div>
          </div>
        </div>
      );

    case 'code':
      return (
        <div className="space-y-4">
          <ProgressStrip detail={detail} />
          <TaskContextRail
            issue={issue}
            customTitle={wf?.customTitle || undefined}
            defaultCollapsed
            showAcceptance={false}
          />
          <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
            <div className="min-w-0 space-y-4">
              {detail && wf ? (
                <WorkflowActions
                  detail={detail}
                  project={project}
                  providers={providers}
                  onChange={onChange}
                  onNavigate={onNavigate}
                />
              ) : (
                <p className={`text-sm ${taskMuted}`}>No active code generation.</p>
              )}
            </div>
            <FilesChangedPanel detail={detail} compact title="Files Changed" />
          </div>
        </div>
      );

    case 'review':
      return (
        <div className="space-y-4">
          <TaskContextRail
            issue={issue}
            customTitle={wf?.customTitle || undefined}
            defaultCollapsed
          />
          {detail && wf ? (
            <ReviewStepPanel
              detail={detail}
              userNotes={detail.run.userInstructions}
              onChange={onChange}
              onNavigate={onNavigate}
              onWorkflowTabChange={() => onWorkflowTabChange('tests')}
            />
          ) : (
            <p className={`text-sm ${taskMuted}`}>Start the task to review code changes.</p>
          )}
        </div>
      );

    case 'tests':
      return detail && wf ? (
        <TestsStepPanel
          detail={detail}
          project={project}
          activities={activities}
          onChange={onChange}
          onNavigate={onNavigate}
          onWorkflowTabChange={onWorkflowTabChange}
        />
      ) : (
        <p className={`text-sm ${taskMuted}`}>Complete review and approve code to run tests.</p>
      );

    case 'pr':
      return detail && wf ? (
        <PrStepPanel
          detail={detail}
          onChange={onChange}
          onNavigate={onNavigate}
          onWorkflowTabChange={onWorkflowTabChange}
        />
      ) : (
        <p className={`text-sm ${taskMuted}`}>Complete tests and deploy before creating a PR.</p>
      );

    case 'deploy':
      return detail && wf ? (
        <DeployStepPanel detail={detail} onChange={onChange} onNavigate={onNavigate} />
      ) : (
        <p className={`text-sm ${taskMuted}`}>Complete the PR step before posting to Jira.</p>
      );

    default:
      return null;
  }
}
