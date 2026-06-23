import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type {
  AiProviderInfo,
  JiraIssueDetail,
  Project,
  RunDetail,
  TaskWorkflowStep,
} from '@cpwork/shared';
import { api, getApiErrorMessage } from '../../lib/api';
import { RunPanel } from '../RunPanel';

export function WorkflowStepContent({
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
  const wf = detail.workflow!;
  const run = detail.run;
  const jira = wf.jiraSnapshot as JiraIssueDetail | null;
  const [branchName, setBranchName] = useState(run.branchName || run.jiraKey || '');
  const [provider, setProvider] = useState(run.provider || providers[0]?.id || '');
  const [model, setModel] = useState(run.model || '');
  const [instructions, setInstructions] = useState(run.userInstructions || '');
  const [planMarkdown, setPlanMarkdown] = useState(wf.planMarkdown || '');
  const [commitMessage, setCommitMessage] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setBranchName(run.branchName || run.jiraKey || '');
    setProvider(run.provider || providers[0]?.id || '');
    setModel(run.model || '');
    setInstructions(run.userInstructions || '');
    setPlanMarkdown(wf.planMarkdown || '');
    if (run.jiraKey && detail.output?.summary) {
      setCommitMessage(`${run.jiraKey}: ${detail.output.summary}`);
    }
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
      (await api.post<{ detail: RunDetail }>(`/workflow/runs/${run.id}/generate-plan`)).data
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
      (await api.post<{ detail: RunDetail }>(`/workflow/runs/${run.id}/run-agent`)).data.detail,
    onMutate: () => setError(null),
    onSuccess: (d) => onChange(d),
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const approveCodeM = useMutation({
    mutationFn: async () =>
      (await api.post<{ detail: RunDetail }>(`/workflow/runs/${run.id}/approve-code`)).data.detail,
    onSuccess: (d) => onChange(d),
  });

  const deployM = useMutation({
    mutationFn: async () =>
      (await api.post<{ detail: RunDetail }>(`/workflow/runs/${run.id}/deploy`)).data.detail,
    onMutate: () => setError(null),
    onSuccess: (d) => onChange(d),
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const completeDeployM = useMutation({
    mutationFn: async () =>
      (await api.post<{ detail: RunDetail }>(`/workflow/runs/${run.id}/complete-deploy`)).data
        .detail,
    onSuccess: (d) => onChange(d),
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  const postJiraM = useMutation({
    mutationFn: async () =>
      (await api.post<{ detail: RunDetail }>(`/workflow/runs/${run.id}/post-jira-comment`)).data
        .detail,
    onSuccess: (d) => onChange(d),
    onError: (err) => setError(getApiErrorMessage(err)),
  });

  useEffect(() => {
    const current = wf.currentStep;
    if (current === 'plan' && !wf.planMarkdown && !generatePlanM.isPending && !generatePlanM.isSuccess) {
      generatePlanM.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wf.currentStep, run.id]);

  const step = wf.currentStep;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {step === 'select' && (
        <div className="card p-4">
          <p className="text-sm text-slate-600">Task selected. Continue to branch setup.</p>
          <button className="btn-primary mt-3" onClick={() => saveStepM.mutate('branch')}>
            Start task →
          </button>
        </div>
      )}

      {step === 'branch' && (
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
          <button
            className="btn-primary"
            disabled={!branchName.trim() || saveStepM.isPending}
            onClick={() => saveStepM.mutate('describe')}
          >
            Continue →
          </button>
        </div>
      )}

      {step === 'describe' && (
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
          <button
            className="btn-primary"
            disabled={saveStepM.isPending}
            onClick={async () => {
              await saveStepM.mutateAsync('plan');
              generatePlanM.mutate();
            }}
          >
            Generate plan →
          </button>
        </div>
      )}

      {step === 'plan' && (
        <div className="card p-4 text-sm text-slate-500">
          {generatePlanM.isPending ? 'Generating implementation plan…' : 'Preparing plan…'}
        </div>
      )}

      {step === 'review_plan' && (
        <div className="card space-y-4 p-4">
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
          <div className="flex flex-wrap gap-2">
            <button
              className="btn-secondary"
              disabled={generatePlanM.isPending}
              onClick={() => generatePlanM.mutate()}
            >
              Regenerate
            </button>
            <button
              className="btn-primary"
              disabled={!planMarkdown.trim() || approvePlanM.isPending}
              onClick={() => approvePlanM.mutate()}
            >
              Approve plan →
            </button>
          </div>
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
          <button
            className="btn-primary"
            disabled={runAgentM.isPending}
            onClick={() => runAgentM.mutate()}
          >
            {runAgentM.isPending ? 'Agent running…' : 'Run agent →'}
          </button>
        </div>
      )}

      {(step === 'code_review' || step === 'deploy' || step === 'commit') && detail.output && (
        <RunPanel detail={detail} onChange={onChange} />
      )}

      {step === 'code_review' && detail.output && (
        <div className="flex gap-2">
          <button
            className="btn-primary"
            disabled={approveCodeM.isPending}
            onClick={() => approveCodeM.mutate()}
          >
            Approve code →
          </button>
        </div>
      )}

      {step === 'deploy' && (
        <div className="card space-y-4 p-4">
          <p className="text-sm text-slate-600">
            Run the local Magento deployment pipeline inside the <strong>php-fpm</strong> Docker
            container for <code className="font-mono text-xs">{project.name}</code>.
          </p>
          {!detail.applied && detail.output && (
            <p className="text-sm text-amber-700">
              Apply code changes in the review panel above before deploying.
            </p>
          )}
          <button
            className="btn-primary"
            disabled={deployM.isPending}
            onClick={() => deployM.mutate()}
          >
            {deployM.isPending ? 'Deploying…' : 'Run local deploy'}
          </button>

          {detail.deploy && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Deploy {detail.deploy.ok ? '✅' : '❌'}
              </h3>
              {detail.deploy.steps.map((s) => (
                <details key={s.key} className="rounded-md border border-slate-200">
                  <summary className="cursor-pointer px-3 py-1.5 text-xs">
                    <span
                      className={
                        s.skipped ? 'text-slate-400' : s.ok ? 'text-green-600' : 'text-red-600'
                      }
                    >
                      {s.skipped ? '○' : s.ok ? '✓' : '✗'} {s.label}
                    </span>
                  </summary>
                  <pre className="overflow-x-auto bg-slate-900 p-2 text-[11px] text-slate-200">
                    {s.output}
                  </pre>
                </details>
              ))}
            </div>
          )}

          <button
            className="btn-primary"
            disabled={!detail.deploy?.ok || completeDeployM.isPending}
            onClick={() => completeDeployM.mutate()}
          >
            Continue to commit →
          </button>
        </div>
      )}

      {step === 'commit' && (
        <div className="card space-y-3 p-4">
          <p className="text-sm text-slate-600">
            Use the panel above to apply, test, commit, and push. Then continue to Jira comment.
          </p>
          <div>
            <label className="label">Commit message</label>
            <input
              className="input font-mono text-sm"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
            />
          </div>
          <button className="btn-primary" onClick={() => onNavigate('jira_comment')}>
            Continue to Jira comment →
          </button>
        </div>
      )}

      {step === 'jira_comment' && (
        <div className="card space-y-4 p-4">
          <p className="text-sm text-slate-600">
            Post a formatted summary comment to Jira ticket{' '}
            <span className="font-mono">{run.jiraKey}</span>.
          </p>
          {wf.jiraCommentPostedAt ? (
            <p className="text-sm text-green-700">Comment posted.</p>
          ) : (
            <button
              className="btn-primary"
              disabled={!run.jiraKey || postJiraM.isPending}
              onClick={() => postJiraM.mutate()}
            >
              Post Jira comment →
            </button>
          )}
        </div>
      )}

      {step === 'done' && (
        <div className="card space-y-2 p-6 text-center">
          <p className="text-lg font-semibold text-green-700">Workflow complete</p>
          <p className="text-sm text-slate-500">
            Task {run.jiraKey || wf.customTitle} — branch {run.branchName}
          </p>
          {wf.testPassRate && (
            <p className="text-sm text-slate-600">Tests: {wf.testPassRate}</p>
          )}
        </div>
      )}
    </div>
  );
}
