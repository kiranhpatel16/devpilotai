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

  async function runDeployPipeline() {
    if (pipelineRunningRef.current) return;
    pipelineRunningRef.current = true;
    setPipelineRunning(true);
    setDeployModalOpen(true);
    setDeployPhase('deploy');
    setDeployModalError(null);

    try {
      await deployM.mutateAsync();
      const afterDeploy = await pollDeployStatus();
      if (!afterDeploy.deploy?.ok) {
        setDeployPhase('failed');
        setDeployModalError('Local deploy failed. Review the output and try again.');
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
  }

  function closeDeployModal() {
    setDeployModalOpen(false);
    setDeployModalError(null);
    if (deployPhase === 'done') setDeployPhase('deploy');
  }

  return {
    runDeployPipeline,
    pipelineRunning,
    deployModalOpen,
    setDeployModalOpen,
    deployPhase,
    deployModalError,
    closeDeployModal,
    deployPending: deployM.isPending || completeDeployM.isPending,
  };
}
