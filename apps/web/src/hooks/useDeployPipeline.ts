import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { RunDetail } from '@cpwork/shared';
import { api, getApiErrorMessage, longRequest } from '../lib/api';
import type { DeployPipelinePhase } from '../components/task-workflow/DeployProgressModal';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useDeployPipeline(detail: RunDetail, onChange: (d: RunDetail) => void) {
  const runId = detail.run.id;
  const [deployModalOpen, setDeployModalOpen] = useState(false);
  const [deployPhase, setDeployPhase] = useState<DeployPipelinePhase>('deploy');
  const [deployModalError, setDeployModalError] = useState<string | null>(null);
  const [deployFixing, setDeployFixing] = useState(false);
  const [deployApplying, setDeployApplying] = useState(false);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const pipelineRunningRef = useRef(false);

  const deployM = useMutation({
    mutationFn: async () =>
      (await api.post<{ detail: RunDetail }>(`/workflow/runs/${runId}/deploy`, undefined, longRequest))
        .data.detail,
  });

  const completeDeployM = useMutation({
    mutationFn: async () =>
      (await api.post<{ detail: RunDetail }>(`/workflow/runs/${runId}/complete-deploy`, undefined, longRequest))
        .data.detail,
  });

  async function pollDeployStatus(): Promise<RunDetail> {
    while (true) {
      const latest = (await api.get<{ detail: RunDetail }>(`/workflow/runs/${runId}`)).data.detail;
      onChange(latest);
      if (!latest.deploy?.running) return latest;
      await sleep(2000);
    }
  }

  async function finishDeployPipeline(afterDeploy: RunDetail): Promise<boolean> {
    if (!afterDeploy.deploy?.ok) {
      setDeployPhase('failed');
      const analysis = afterDeploy.deploy?.analysis;
      setDeployModalError(
        analysis?.summary || 'Local deploy failed. Review the output and try again.',
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

  async function runDeployFix() {
    if (pipelineRunningRef.current) return;
    pipelineRunningRef.current = true;
    setPipelineRunning(true);
    setDeployModalOpen(true);
    setDeployPhase('fixing');
    setDeployFixing(true);
    setDeployModalError(null);

    try {
      const result = (
        await api.post<{ detail: RunDetail; fix: { summary: string } }>(
          `/workflow/runs/${runId}/deploy-fix`,
          {},
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

    try {
      const updated = (
        await api.post<{ detail: RunDetail }>(`/runs/${runId}/apply`, { paths })
      ).data.detail;
      onChange(updated);
      setDeployPhase('review');
    } catch (err) {
      setDeployModalError(getApiErrorMessage(err));
      try {
        const latest = (await api.get<{ detail: RunDetail }>(`/workflow/runs/${runId}`)).data.detail;
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

  function openDeployModal() {
    const hasUnappliedFix = !detail.applied && (detail.diffs?.length ?? 0) > 0;
    setDeployPhase(
      detail.deploy?.ok ? 'done' : hasUnappliedFix ? 'review' : 'failed',
    );
    setDeployModalOpen(true);
  }

  function closeDeployModal() {
    setDeployModalOpen(false);
    setDeployModalError(null);
    setDeployFixing(false);
    setDeployApplying(false);
    if (deployPhase === 'done') setDeployPhase('deploy');
  }

  return {
    runDeployPipeline,
    runDeployFix,
    applyDeployFix,
    redeployAfterFix,
    pipelineRunning,
    deployModalOpen,
    setDeployModalOpen,
    openDeployModal,
    deployPhase,
    deployModalError,
    closeDeployModal,
    deployFixing,
    deployApplying,
    deployPending: deployM.isPending || completeDeployM.isPending,
  };
}
