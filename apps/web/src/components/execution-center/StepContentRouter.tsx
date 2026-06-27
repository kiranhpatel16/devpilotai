import type {
  Activity,
  AiProviderInfo,
  JiraIssueDetail,
  Project,
  RunDetail,
  TaskWorkflowStep,
} from '@cpwork/shared';
import { BuildStepPanel } from './BuildStepPanel';
import { CodeStepPanel } from './CodeStepPanel';
import { DeployStepPanel } from './DeployStepPanel';
import { JiraCommentStepPanel } from './JiraCommentStepPanel';
import { PrStepPanel } from './PrStepPanel';
import { QaStepPanel } from './QaStepPanel';
import { ProgressStrip } from './ProgressStrip';
import { ReviewStepPanel } from './ReviewStepPanel';
import { RequirementsStepPanel } from './RequirementsStepPanel';
import { SetupStepPanel } from './SetupStepPanel';
import { PreDevApprovalPanel } from './PreDevApprovalPanel';
import { RequirementAnalysisSection } from './RequirementAnalysisSection';
import { WorkflowSummaryRail } from './WorkflowSummaryRail';
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
  codeGenPending?: boolean;
  onCodeGenPending?: (pending: boolean) => void;
}

function WithRail({
  detail,
  project,
  providers,
  children,
}: {
  detail: RunDetail | null;
  project: Project;
  providers: AiProviderInfo[];
  children: React.ReactNode;
}) {
  return (
    <div className="grid min-h-0 gap-4 lg:grid-cols-[1fr_240px]">
      <div className="min-w-0">{children}</div>
      <WorkflowSummaryRail detail={detail} project={project} providers={providers} />
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
  codeGenPending,
  onCodeGenPending,
}: StepContentRouterProps) {
  const wf = detail?.workflow;

  switch (tab) {
    case 'requirements':
      return (
        <WithRail detail={detail} project={project} providers={providers}>
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
          {detail && (
            <RequirementAnalysisSection
              detail={detail}
              onChange={onChange}
              onError={onError}
            />
          )}
        </WithRail>
      );

    case 'setup':
      return detail ? (
        <WithRail detail={detail} project={project} providers={providers}>
          <SetupStepPanel
            detail={detail}
            project={project}
            providers={providers}
            onChange={onChange}
            onWorkflowTabChange={onWorkflowTabChange}
            onError={onError}
          />
        </WithRail>
      ) : null;

    case 'plan':
      return (
        <WithRail detail={detail} project={project} providers={providers}>
          <ProgressStrip detail={detail} project={project} providers={providers} />
          {detail && wf ? (
            <PreDevApprovalPanel
              detail={detail}
              onChange={onChange}
              onWorkflowTabChange={onWorkflowTabChange}
              onError={onError}
              onCodeGenPending={onCodeGenPending}
              onInterimDetail={onChange}
            />
          ) : (
            <p className={`text-sm ${taskMuted}`}>Complete setup to generate plan artifacts.</p>
          )}
        </WithRail>
      );

    case 'code':
      return (
        <WithRail detail={detail} project={project} providers={providers}>
          <div className="space-y-4">
            <ProgressStrip detail={detail} project={project} providers={providers} />
            {detail && wf ? (
              <CodeStepPanel
                detail={detail}
                project={project}
                providers={providers}
                onChange={onChange}
                onNavigate={onNavigate}
                onWorkflowTabChange={onWorkflowTabChange}
                codeGenPending={codeGenPending}
              />
            ) : (
              <p className={`text-sm ${taskMuted}`}>No active code generation.</p>
            )}
          </div>
        </WithRail>
      );

    case 'build':
      return (
        <WithRail detail={detail} project={project} providers={providers}>
          {detail && wf ? (
            <BuildStepPanel
              detail={detail}
              project={project}
              onChange={onChange}
              onNavigate={onNavigate}
              onWorkflowTabChange={onWorkflowTabChange}
            />
          ) : (
            <p className={`text-sm ${taskMuted}`}>Complete code generation first.</p>
          )}
        </WithRail>
      );

    case 'review':
      return (
        <WithRail detail={detail} project={project} providers={providers}>
          {detail && wf ? (
            <ReviewStepPanel
                detail={detail}
                userNotes={detail.run.userInstructions}
                onChange={onChange}
                onNavigate={onNavigate}
                onWorkflowTabChange={onWorkflowTabChange}
            />
          ) : (
            <p className={`text-sm ${taskMuted}`}>Complete code review before build verification.</p>
          )}
        </WithRail>
      );

    case 'pr':
      return detail && wf ? (
        <WithRail detail={detail} project={project} providers={providers}>
          <PrStepPanel
            detail={detail}
            onChange={onChange}
            onNavigate={onNavigate}
            onWorkflowTabChange={onWorkflowTabChange}
          />
        </WithRail>
      ) : (
        <p className={`text-sm ${taskMuted}`}>Approve code review before git operations.</p>
      );

    case 'qa':
      return detail && wf ? (
        <WithRail detail={detail} project={project} providers={providers}>
          <QaStepPanel
            detail={detail}
            onChange={onChange}
            onNavigate={onNavigate}
            onWorkflowTabChange={onWorkflowTabChange}
          />
        </WithRail>
      ) : (
        <p className={`text-sm ${taskMuted}`}>Complete PR step before QA.</p>
      );

    case 'jira':
      return detail && wf ? (
        <WithRail detail={detail} project={project} providers={providers}>
          <JiraCommentStepPanel
            detail={detail}
            onChange={onChange}
            onNavigate={onNavigate}
            onWorkflowTabChange={onWorkflowTabChange}
          />
        </WithRail>
      ) : (
        <p className={`text-sm ${taskMuted}`}>Complete QA before posting to Jira.</p>
      );

    case 'done':
      return detail && wf ? (
        <WithRail detail={detail} project={project} providers={providers}>
          <DeployStepPanel detail={detail} onNavigate={onNavigate} />
        </WithRail>
      ) : (
        <p className={`text-sm ${taskMuted}`}>Finish the workflow to see completion summary.</p>
      );

    default:
      return null;
  }
}
