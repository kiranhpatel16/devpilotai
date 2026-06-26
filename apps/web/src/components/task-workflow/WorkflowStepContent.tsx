import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type {
  AiProviderInfo,
  JiraIssueDetail,
  Project,
  RunDetail,
  TaskWorkflowStep,
} from '@cpwork/shared';
import { api, getApiErrorMessage, longRequest } from '../../lib/api';
import { useWorkflowBusy } from '../../context/WorkflowBusyContext';
import { RunPanel } from '../RunPanel';
import { previousStep } from './constants';
import {
  DeployProgressModal,
  type DeployPipelinePhase,
} from './DeployProgressModal';
import type { WorkflowTab } from '../execution-center/WorkflowTabs';
import { SelectedJiraTaskCard } from './SelectedJiraTaskCard';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function PlanGeneratingLoader({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10">
      <div
        className="h-9 w-9 animate-spin rounded-full border-2 border-slate-200 border-t-brand-600"
        role="status"
        aria-label={label}
      />
      <p className="text-sm text-slate-500">{label}</p>
    </div>
  );
}

function StepActions({
  step,
  onBack,
  backPending,
  children,
}: {
  step: TaskWorkflowStep;
  onBack: (step: TaskWorkflowStep) => void;
  backPending?: boolean;
  children?: ReactNode;
}) {
  const prev = previousStep(step);
  return (
    <div className="flex flex-wrap gap-2">
      {prev && (
        <button
          type="button"
          className="btn-secondary"
          disabled={backPending}
          onClick={() => onBack(prev)}
        >
          ← Back
        </button>
      )}
      {children}
    </div>
  );
}

export function WorkflowStepContent({
  detail,
  project,
  providers,
  onChange,
  onNavigate,
  onShowHistory,
  onStartNewTask,
  onWorkflowTabChange,
  hideSetupSteps,
}: {
  detail: RunDetail;
  project: Project;
  providers: AiProviderInfo[];
  onChange: (d: RunDetail) => void;
  onNavigate: (step: TaskWorkflowStep) => void;
  onShowHistory?: () => void;
  onStartNewTask?: () => void;
  onWorkflowTabChange?: (tab: WorkflowTab) => void;
  /** When true, select/branch/describe UIs are omitted (handled on Requirements tab). */
  hideSetupSteps?: boolean;
}) {
  const wf = detail.workflow;
  if (!wf) {
    return (
      <p className="text-sm text-slate-500">
        Workflow state is missing for this run. Try restoring the task from history.
      </p>
    );
  }
  const run = detail.run;
  const jira = wf.jiraSnapshot as JiraIssueDetail | null;
  const [branchName, setBranchName] = useState(run.branchName || run.jiraKey || '');
  const [provider, setProvider] = useState(run.provider || providers[0]?.id || '');
  const [model, setModel] = useState(run.model || '');
  const [instructions, setInstructions] = useState(run.userInstructions || '');
  const [planMarkdown, setPlanMarkdown] = useState(wf.planMarkdown || '');
  const [jiraCommentDraft, setJiraCommentDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [deployPhase, setDeployPhase] = useState<DeployPipelinePhase>('deploy');
  const [deployModalError, setDeployModalError] = useState<string | null>(null);
  const [deployFixing, setDeployFixing] = useState(false);
  const [deployApplying, setDeployApplying] = useState(false);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const pipelineRunningRef = useRef(false);
  const jiraDraftInitializedRef = useRef(false);

  useEffect(() => {
    setBranchName(run.branchName || run.jiraKey || '');
    setProvider(run.provider || providers[0]?.id || '');
    setModel(run.model || '');
    setInstructions(run.userInstructions || '');
    setPlanMarkdown(wf.planMarkdown || '');
  }, [run.id, wf.planMarkdown, detail.output?.summary]);

  const activeProvider = providers.find((p) => p.id === provider) || providers[0];

  const saveStepM = useMutation({
    mutationFn: async (step: TaskWorkflowStep) =>
      (
        await api.patch<{ detail: RunDetail }>(`/workflow/runs/${run.id}/step`, {
          step,
          branchName,
          provider: provider || null,
          model: model || null,
          userInstructions: instructions || null,
        })
      ).data.detail,
    onMutate: () => setError(null),
    onSuccess: (d) => onChange(d),
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const generatePlanM = useMutation({
    mutationFn: async () =>
      (await api.post<{ detail: RunDetail }>(`/workflow/runs/${run.id}/generate-plan`, undefined, longRequest))
        .data
        .detail,
    onMutate: () => setError(null),
    onSuccess: (d) => onChange(d),
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const savePlanM = useMutation({
    mutationFn: async () =>
      (
        await api.patch<{ detail: RunDetail }>(`/workflow/runs/${run.id}/plan`, {
          planMarkdown,
        })
      ).data.detail,
    onSuccess: (d) => onChange(d),
  });

  const approvePlanM = useMutation({
    mutationFn: async () =>
      (await api.post<{ detail: RunDetail }>(`/workflow/runs/${run.id}/approve-plan`)).data.detail,
    onSuccess: (d) => onChange(d),
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const runAgentM = useMutation({
    mutationFn: async () =>
      (await api.post<{ detail: RunDetail }>(`/workflow/runs/${run.id}/run-agent`, undefined, longRequest))
        .data.detail,
    onMutate: () => setError(null),
    onSuccess: (d) => {
      onChange(d);
      if (d.workflow?.currentStep === 'code_review') {
        onWorkflowTabChange?.('review');
      }
    },
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const approveCodeM = useMutation({
    mutationFn: async () =>
      (await api.post<{ detail: RunDetail }>(`/workflow/runs/${run.id}/approve-code`)).data.detail,
    onSuccess: (d) => onChange(d),
  });

  const deployM = useMutation({
    mutationFn: async () =>
      (await api.post<{ detail: RunDetail }>(`/workflow/runs/${run.id}/deploy`, undefined, longRequest))
        .data.detail,
    onMutate: () => setError(null),
    onSuccess: (d) => onChange(d),
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const completeDeployM = useMutation({
    mutationFn: async () =>
      (await api.post<{ detail: RunDetail }>(`/workflow/runs/${run.id}/complete-deploy`, undefined, longRequest))
        .data.detail,
    onSuccess: (d) => onChange(d),
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  async function pollDeployStatus(): Promise<RunDetail> {
    while (true) {
      const latest = (await api.get<{ detail: RunDetail }>(`/workflow/runs/${run.id}`)).data.detail;
      onChange(latest);
      const deploy = latest.deploy;
      if (!deploy?.running) {
        return latest;
      }
      await sleep(2000);
    }
  }

  async function finishDeployPipeline(afterDeploy: RunDetail) {
    if (!afterDeploy.deploy?.ok) {
      setDeployPhase('failed');
      const analysis = afterDeploy.deploy?.analysis;
      setDeployModalError(
        analysis?.summary || 'Local deploy failed. Review the step output above.',
      );
      return false;
    }

    const current = await completeDeployM.mutateAsync();
    onChange(current);
    setDeployPhase('done');
    return true;
  }

  async function runDeployPipeline() {
    if (pipelineRunningRef.current) return;
    pipelineRunningRef.current = true;
    setPipelineRunning(true);
    setDeployModalOpen(true);
    setDeployPhase('deploy');
    setDeployModalError(null);
    setDeployFixing(false);
    setError(null);

    try {
      await deployM.mutateAsync();
      const afterDeploy = await pollDeployStatus();
      await finishDeployPipeline(afterDeploy);
    } catch (err) {
      setDeployPhase('failed');
      setDeployModalError(getApiErrorMessage(err));
    } finally {
      pipelineRunningRef.current = false;
      setPipelineRunning(false);
      setDeployFixing(false);
    }
  }

  async function runDeployFix(instructions?: string) {
    if (pipelineRunningRef.current) return;
    pipelineRunningRef.current = true;
    setPipelineRunning(true);
    setDeployModalOpen(true);
    setDeployPhase('fixing');
    setDeployFixing(true);
    setDeployModalError(null);
    setError(null);

    try {
      const result = (
        await api.post<{ detail: RunDetail; fix: { summary: string } }>(
          `/workflow/runs/${run.id}/deploy-fix`,
          { instructions: instructions?.trim() || null },
          longRequest,
        )
      ).data;
      onChange(result.detail);
      setDeployPhase('review');
    } catch (err) {
      setDeployPhase('failed');
      setDeployModalError(getApiErrorMessage(err));
    } finally {
      pipelineRunningRef.current = false;
      setPipelineRunning(false);
      setDeployFixing(false);
    }
  }

  async function applyDeployFix(paths: string[]) {
    if (pipelineRunningRef.current) return;
    pipelineRunningRef.current = true;
    setDeployApplying(true);
    setDeployModalError(null);
    setError(null);

    try {
      const updated = (
        await api.post<{ detail: RunDetail }>(`/runs/${run.id}/apply`, { paths })
      ).data.detail;
      onChange(updated);
      setDeployPhase('review');
    } catch (err) {
      setDeployModalError(getApiErrorMessage(err));
      try {
        const latest = (await api.get<{ detail: RunDetail }>(`/workflow/runs/${run.id}`)).data.detail;
        onChange(latest);
      } catch {
        // keep existing detail if refetch fails
      }
    } finally {
      pipelineRunningRef.current = false;
      setDeployApplying(false);
    }
  }

  async function redeployAfterFix() {
    if (pipelineRunningRef.current) return;
    pipelineRunningRef.current = true;
    setPipelineRunning(true);
    setDeployPhase('deploy');
    setDeployModalError(null);
    setError(null);

    try {
      await deployM.mutateAsync();
      const afterDeploy = await pollDeployStatus();
      await finishDeployPipeline(afterDeploy);
    } catch (err) {
      setDeployPhase('failed');
      setDeployModalError(getApiErrorMessage(err));
    } finally {
      pipelineRunningRef.current = false;
      setPipelineRunning(false);
    }
  }

  function closeDeployModal() {
    setDeployModalOpen(false);
    setDeployModalError(null);
    setDeployFixing(false);
    setDeployApplying(false);
    if (deployPhase === 'done') {
      setDeployPhase('deploy');
    }
  }

  const postJiraM = useMutation({
    mutationFn: async (comment: string) =>
      (
        await api.post<{ detail: RunDetail }>(`/workflow/runs/${run.id}/post-jira-comment`, {
          comment,
        })
      ).data.detail,
    onMutate: () => setError(null),
    onSuccess: (d) => onChange(d),
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const step = wf.currentStep;

  useWorkflowBusy('save-step', saveStepM.isPending, 'Saving…');
  useWorkflowBusy('generate-plan', generatePlanM.isPending, 'Generating plan…');
  useWorkflowBusy('run-agent', runAgentM.isPending, 'Developer agent generating code…');
  useWorkflowBusy('approve-plan', approvePlanM.isPending, 'Approving plan…');
  useWorkflowBusy('approve-code', approveCodeM.isPending, 'Approving code…');
  useWorkflowBusy(
    'workflow-deploy',
    pipelineRunning || deployM.isPending || completeDeployM.isPending || deployFixing || deployApplying,
    deployFixing ? 'AI agent fixing deploy error…' : 'Running local deploy…',
  );
  useWorkflowBusy('post-jira', postJiraM.isPending, 'Posting to Jira…');

  const savedPlanQ = useQuery({
    queryKey: ['saved-plan', run.id, wf.planFilePath],
    queryFn: async () =>
      (
        await api.get<{ planMarkdown: string; planFilePath: string }>(
          `/workflow/runs/${run.id}/saved-plan`,
        )
      ).data,
    enabled: step === 'plan' && !wf.planMarkdown && !!wf.planFilePath,
  });

  const hasSavedPlan = !!(wf.planMarkdown || wf.planFilePath);
  const isLoadingSavedPlan =
    step === 'plan' && !wf.planMarkdown && !!wf.planFilePath && savedPlanQ.isLoading;
  const showPlanGenerating =
    step === 'plan' && ((!hasSavedPlan && !planMarkdown) || isLoadingSavedPlan);
  const showPlanEditor =
    step === 'review_plan' ||
    (step === 'plan' && hasSavedPlan && !isLoadingSavedPlan && !!(wf.planMarkdown || planMarkdown));

  const jiraPreviewQ = useQuery({
    queryKey: ['jira-comment-preview', run.id],
    queryFn: async () =>
      (await api.get<{ comment: string }>(`/workflow/runs/${run.id}/jira-comment-preview`)).data,
    enabled: step === 'jira_comment' && !wf.jiraCommentPostedAt && !!run.jiraKey,
  });

  useEffect(() => {
    jiraDraftInitializedRef.current = false;
    setJiraCommentDraft('');
  }, [run.id]);

  useEffect(() => {
    if (
      jiraPreviewQ.data?.comment &&
      !jiraDraftInitializedRef.current &&
      !wf.jiraCommentPostedAt
    ) {
      setJiraCommentDraft(jiraPreviewQ.data.comment);
      jiraDraftInitializedRef.current = true;
    }
  }, [jiraPreviewQ.data?.comment, wf.jiraCommentPostedAt]);

  useEffect(() => {
    if (savedPlanQ.data?.planMarkdown) {
      setPlanMarkdown(savedPlanQ.data.planMarkdown);
    }
  }, [savedPlanQ.data?.planMarkdown]);

  useEffect(() => {
    const current = wf.currentStep;
    if (
      current === 'plan' &&
      !hasSavedPlan &&
      !savedPlanQ.isLoading &&
      !generatePlanM.isPending &&
      !generatePlanM.isSuccess
    ) {
      generatePlanM.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wf.currentStep, run.id, hasSavedPlan, savedPlanQ.isLoading]);

  useEffect(() => {
    if (wf.currentStep !== 'deploy' || !detail.deploy?.running || pipelineRunningRef.current) return;
    setDeployModalOpen(true);
    setDeployPhase('deploy');
    void (async () => {
      pipelineRunningRef.current = true;
      setPipelineRunning(true);
      try {
        const afterDeploy = await pollDeployStatus();
        if (!afterDeploy.deploy?.ok) {
          setDeployPhase('failed');
          return;
        }
        const current = await completeDeployM.mutateAsync();
        onChange(current);
        setDeployPhase('done');
      } catch (err) {
        setDeployPhase('failed');
        setDeployModalError(getApiErrorMessage(err));
      } finally {
        pipelineRunningRef.current = false;
        setPipelineRunning(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wf.currentStep, run.id, detail.deploy?.running]);

  const goBack = (target: TaskWorkflowStep) => onNavigate(target);

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {step === 'select' && !hideSetupSteps && (
        <div className="card space-y-4 p-4">
          {jira ? (
            <SelectedJiraTaskCard issue={jira} productionBranch={project.git.productionBranch} />
          ) : (
            <div>
              <span className="badge bg-brand-100 text-brand-700">Custom task</span>
              <h2 className="mt-2 text-lg font-semibold">{wf.customTitle || 'Custom task'}</h2>
            </div>
          )}
          <StepActions step={step} onBack={goBack}>
            <button className="btn-primary" onClick={() => saveStepM.mutate('branch')}>
              Start task →
            </button>
          </StepActions>
        </div>
      )}

      {step === 'branch' && !hideSetupSteps && (
        <div className="card space-y-4 p-4">
          <div>
            <h2 className="text-lg font-semibold">
              {jira ? (
                <>
                  <span className="font-mono text-brand-700">{jira.key}</span> · {jira.summary}
                </>
              ) : (
                wf.customTitle || 'Custom task'
              )}
            </h2>
            {jira?.url && (
              <a
                href={jira.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-brand-600 hover:underline"
              >
                Open in Jira ↗
              </a>
            )}
          </div>
          <div>
            <label className="label">Branch name</label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400">
                from <code>{project.git.productionBranch}</code> →
              </span>
              <input
                className="input max-w-xs font-mono"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">AI provider</label>
              <select
                className="input"
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value);
                  setModel('');
                }}
              >
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Model</label>
              <select
                className="input"
                value={model || activeProvider?.defaultModel || ''}
                onChange={(e) => setModel(e.target.value)}
              >
                {activeProvider?.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <StepActions step={step} onBack={goBack} backPending={saveStepM.isPending}>
            <button
              className="btn-primary"
              disabled={!branchName.trim() || saveStepM.isPending}
              onClick={() => saveStepM.mutate('describe')}
            >
              Continue →
            </button>
          </StepActions>
        </div>
      )}

      {step === 'describe' && !hideSetupSteps && (
        <div className="card space-y-4 p-4">
          {jira && (
            <div>
              <label className="label">Jira description</label>
              <textarea
                readOnly
                className="input min-h-[120px] bg-slate-50 text-slate-600"
                value={jira.description || '(no description)'}
              />
            </div>
          )}
          <div>
            <label className="label">Your instructions</label>
            <textarea
              className="input min-h-[100px]"
              placeholder="Add detail on top of the Jira description…"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>
          <StepActions step={step} onBack={goBack} backPending={saveStepM.isPending || generatePlanM.isPending}>
            <button
              className="btn-primary"
              disabled={saveStepM.isPending || generatePlanM.isPending}
              onClick={async () => {
                await saveStepM.mutateAsync('plan');
                generatePlanM.mutate();
              }}
            >
              {saveStepM.isPending || generatePlanM.isPending ? 'Generating plan…' : 'Generate plan →'}
            </button>
          </StepActions>
        </div>
      )}

      {showPlanGenerating && (
        <div className="card space-y-3 p-4">
          <PlanGeneratingLoader
            label={
              isLoadingSavedPlan
                ? 'Loading saved plan…'
                : generatePlanM.isPending
                  ? 'Generating implementation plan…'
                  : 'Preparing plan…'
            }
          />
          <StepActions step={step} onBack={goBack} backPending={generatePlanM.isPending} />
        </div>
      )}

      {showPlanEditor && (
        <div className="card relative space-y-4 p-4">
          {generatePlanM.isPending && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-white/85">
              <PlanGeneratingLoader label="Regenerating implementation plan…" />
            </div>
          )}
          {wf.planFilePath && (
            <p className="text-xs text-slate-500">
              Saved to <code className="rounded bg-slate-100 px-1">{wf.planFilePath}</code>
            </p>
          )}
          <textarea
            className="input min-h-[280px] font-mono text-xs"
            value={planMarkdown}
            onChange={(e) => setPlanMarkdown(e.target.value)}
            onBlur={() => savePlanM.mutate()}
          />
          <StepActions step={step} onBack={goBack}>
            {step === 'plan' && (
              <button
                className="btn-primary"
                disabled={!planMarkdown.trim()}
                onClick={() => saveStepM.mutate('review_plan')}
              >
                Continue to review →
              </button>
            )}
            {step === 'review_plan' && (
              <>
                <button
                  className="btn-secondary"
                  disabled={generatePlanM.isPending}
                  onClick={() => generatePlanM.mutate()}
                >
                  {generatePlanM.isPending ? 'Regenerating…' : 'Regenerate'}
                </button>
                <button
                  className="btn-primary"
                  disabled={!planMarkdown.trim() || approvePlanM.isPending}
                  onClick={() => approvePlanM.mutate()}
                >
                  Approve plan →
                </button>
              </>
            )}
          </StepActions>
        </div>
      )}

      {step === 'agent' && (
        <div className="card space-y-4 p-4">
          <p className="text-sm text-slate-600">
            Plan approved. Run the agent to create branch{' '}
            <code className="font-mono">{run.branchName}</code> from{' '}
            <code className="font-mono">origin/{project.git.productionBranch}</code> and implement
            the plan.
          </p>
          <p className="text-xs text-slate-400">
            Uncommitted local changes are auto-stashed before branching (recover with{' '}
            <code className="font-mono">git stash list</code> /{' '}
            <code className="font-mono">git stash pop</code>).
          </p>
          {detail.git?.stashed && (
            <p className="text-xs text-amber-700">
              Previous local changes were stashed before creating the branch.
            </p>
          )}
          <StepActions step={step} onBack={goBack}>
            <button
              type="button"
              className="btn-primary"
              disabled={runAgentM.isPending}
              onClick={() => runAgentM.mutate()}
            >
              {runAgentM.isPending ? 'Agent running…' : 'Run agent →'}
            </button>
          </StepActions>
        </div>
      )}

      {step === 'code_review' && detail.output && hideSetupSteps && (
        <div className="card space-y-3 p-4">
          <p className="text-sm text-slate-600">
            Code generation finished. Open the <strong>Review</strong> tab to inspect diffs and apply
            changes.
          </p>
          {onWorkflowTabChange && (
            <button
              type="button"
              className="btn-primary"
              onClick={() => onWorkflowTabChange('review')}
            >
              Go to Review →
            </button>
          )}
        </div>
      )}

      {(step === 'deploy' || step === 'commit') && detail.output && !hideSetupSteps && (
        <RunPanel detail={detail} onChange={onChange} />
      )}

      {step === 'code_review' && detail.output && !hideSetupSteps && (
        <RunPanel detail={detail} onChange={onChange} />
      )}

      {step === 'code_review' && detail.output && !hideSetupSteps && (
        <StepActions step={step} onBack={goBack}>
          <button
            className="btn-primary"
            disabled={approveCodeM.isPending}
            onClick={() => approveCodeM.mutate()}
          >
            Approve code →
          </button>
        </StepActions>
      )}

      {step === 'deploy' && !hideSetupSteps && (
        <div className="card space-y-4 p-4">
          <p className="text-sm text-slate-600">
            Run the local Magento deployment pipeline inside the <strong>php-fpm</strong> Docker
            container for <code className="font-mono text-xs">{project.name}</code>. After deploy
            succeeds, continue to the commit step to commit, push, and open a staging PR manually.
          </p>
          {!detail.applied && detail.output && detail.diffs.length > 0 && (
            <p className="text-sm text-amber-700">
              Review and apply the AI-proposed deploy fix above, or open the deployment modal to
              apply and redeploy.
            </p>
          )}
          {!detail.applied && detail.output && detail.diffs.length === 0 && (
            <p className="text-sm text-amber-700">
              Apply code changes in the review panel above before deploying.
            </p>
          )}

          {detail.deploy && !detail.deploy.running && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Last deploy {detail.deploy.ok ? '✅' : '❌'}
              </h3>
              <button
                type="button"
                className="text-xs font-medium text-brand-600 hover:underline"
                onClick={() => {
                  const hasUnappliedFix = !detail.applied && (detail.diffs?.length ?? 0) > 0;
                  setDeployPhase(
                    detail.deploy?.ok ? 'done' : hasUnappliedFix ? 'review' : 'failed',
                  );
                  setDeployModalOpen(true);
                }}
              >
                View deployment progress ↗
              </button>
            </div>
          )}

          <StepActions step={step} onBack={goBack}>
            <button
              className="btn-primary"
              disabled={pipelineRunning || deployM.isPending || !detail.applied}
              onClick={() => void runDeployPipeline()}
            >
              {pipelineRunning || deployM.isPending || detail.deploy?.running
                ? 'Deploying…'
                : 'Run local deploy →'}
            </button>
          </StepActions>

          <DeployProgressModal
            open={deployModalOpen}
            detail={detail}
            phase={deployPhase}
            error={deployModalError}
            fixing={deployFixing}
            applying={deployApplying}
            onClose={closeDeployModal}
            onRetry={() => void runDeployPipeline()}
            onProposeFix={(instructions) => void runDeployFix(instructions)}
            onApplyFix={(paths) => void applyDeployFix(paths)}
            onRedeploy={() => void redeployAfterFix()}
          />
        </div>
      )}

      {step === 'commit' && !hideSetupSteps && (
        <div className="card space-y-3 p-4">
          <p className="text-sm text-slate-600">
            Local deploy completed. Use the commit, push, and staging PR actions in the review panel
            above when you are ready, then continue to post the Jira comment.
          </p>
          {detail.git?.prUrl && (
            <a
              href={detail.git.prUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-sm font-medium text-brand-600 hover:underline"
            >
              View pull request ↗
            </a>
          )}
          <StepActions step={step} onBack={goBack}>
            <button
              className="btn-primary"
              disabled={!detail.git?.committed}
              onClick={() => onNavigate('jira_comment')}
            >
              Continue to Jira comment →
            </button>
          </StepActions>
          {!detail.git?.committed && (
            <p className="text-xs text-slate-500">Commit your changes above before continuing.</p>
          )}
        </div>
      )}

      {step === 'jira_comment' && !hideSetupSteps && (
        <div className="card space-y-4 p-4">
          <p className="text-sm text-slate-600">
            Review and edit the comment below, then post it to Jira ticket{' '}
            <span className="font-mono">{run.jiraKey}</span>.
          </p>
          {wf.jiraCommentPostedAt ? (
            <>
              <p className="text-sm text-green-700">Comment posted.</p>
              {wf.jiraCommentText && (
                <div>
                  <label className="label text-xs uppercase tracking-wide text-slate-500">
                    Posted comment
                  </label>
                  <div className="max-h-80 overflow-y-auto rounded-md border border-green-100 bg-green-50 px-3 py-2 text-sm text-slate-700 whitespace-pre-wrap">
                    {wf.jiraCommentText}
                  </div>
                </div>
              )}
              <StepActions step={step} onBack={goBack} />
            </>
          ) : jiraPreviewQ.isLoading ? (
            <PlanGeneratingLoader label="Loading comment preview…" />
          ) : jiraPreviewQ.isError ? (
            <p className="text-sm text-red-600">{getApiErrorMessage(jiraPreviewQ.error)}</p>
          ) : (
            <>
              <div>
                <label className="label">Comment preview</label>
                <textarea
                  className="input min-h-[280px] font-mono text-xs"
                  value={jiraCommentDraft}
                  onChange={(e) => setJiraCommentDraft(e.target.value)}
                  placeholder="Jira comment preview will appear here…"
                />
              </div>
              <StepActions step={step} onBack={goBack}>
                <button
                  className="btn-primary"
                  disabled={!run.jiraKey || !jiraCommentDraft.trim() || postJiraM.isPending}
                  onClick={() => postJiraM.mutate(jiraCommentDraft.trim())}
                >
                  {postJiraM.isPending ? 'Posting…' : 'Post Jira comment →'}
                </button>
              </StepActions>
            </>
          )}
        </div>
      )}

      {step === 'done' && !hideSetupSteps && (
        <div className="card space-y-4 p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="badge bg-green-100 text-green-700">✓ Task complete</span>
            <span className="font-mono text-sm text-brand-700">{run.jiraKey || wf.customTitle}</span>
            {run.branchName && (
              <>
                <span className="text-slate-400">·</span>
                <span className="font-mono text-sm text-slate-600">{run.branchName}</span>
              </>
            )}
          </div>

          {wf.jiraCommentText ? (
            <div>
              <label className="label text-xs uppercase tracking-wide text-slate-500">
                Jira comment posted
              </label>
              <div className="max-h-80 overflow-y-auto rounded-md border border-green-100 bg-green-50 px-3 py-2 text-sm text-slate-700 whitespace-pre-wrap">
                {wf.jiraCommentText}
              </div>
            </div>
          ) : wf.jiraCommentPostedAt ? (
            <p className="text-sm text-green-700">Jira comment posted successfully.</p>
          ) : null}

          {wf.testPassRate && (
            <p className="text-sm text-slate-600">Tests: {wf.testPassRate}</p>
          )}

          <div className="flex flex-wrap gap-2 pt-2">
            <StepActions step={step} onBack={goBack}>
              {onShowHistory && (
                <button type="button" className="btn-secondary" onClick={onShowHistory}>
                  View history grid →
                </button>
              )}
              {onStartNewTask && (
                <button type="button" className="btn-secondary" onClick={onStartNewTask}>
                  Start new task
                </button>
              )}
            </StepActions>
          </div>
        </div>
      )}
    </div>
  );
}
