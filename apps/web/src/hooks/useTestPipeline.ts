import { useCallback, useRef, useState } from 'react';
import type { RunDetail } from '@cpwork/shared';
import { api, getApiErrorMessage, longRequest } from '../lib/api';

const MAX_FIX_ATTEMPTS = 3;

function hasFailedChecks(test: RunDetail['test']): boolean {
  if (!test?.steps?.length) return false;
  return test.steps.some((s) => !s.ok && !s.skipped);
}

function hasVisualSmokeFailure(test: RunDetail['test']): boolean {
  const step = test?.steps?.find((s) => s.key === 'visual_smoke');
  return !!step && !step.ok && !step.skipped;
}

export function useTestPipeline(detail: RunDetail, onChange: (d: RunDetail) => void) {
  const runId = detail.run.id;
  const [testRunning, setTestRunning] = useState(false);
  const [testFixing, setTestFixing] = useState(false);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const pipelineRunningRef = useRef(false);

  async function runTestsOnce(): Promise<RunDetail> {
    const result = (await api.post<{ detail: RunDetail }>(`/runs/${runId}/test`, undefined, longRequest))
      .data.detail;
    onChange(result);
    return result;
  }

  async function runTestFix(): Promise<RunDetail> {
    const result = (
      await api.post<{ detail: RunDetail; fix: { summary: string } }>(
        `/workflow/runs/${runId}/test-fix`,
        {},
        longRequest,
      )
    ).data;
    onChange(result.detail);
    return result.detail;
  }

  async function applyTestFix(fixDetail: RunDetail): Promise<RunDetail> {
    const paths = fixDetail.diffs?.map((d) => d.path) ?? fixDetail.output?.files?.map((f) => f.path) ?? [];
    const result = (
      await api.post<{ detail: RunDetail }>(`/runs/${runId}/apply`, { paths }, longRequest)
    ).data.detail;
    onChange(result);
    return result;
  }

  const runFixCycle = useCallback(async (): Promise<RunDetail | null> => {
    try {
      const fixDetail = await runTestFix();
      const paths =
        fixDetail.diffs?.map((d) => d.path) ??
        fixDetail.output?.files?.map((f) => f.path) ??
        [];
      if (!paths.length) {
        setPipelineError('AI agent did not propose any file changes.');
        return null;
      }
      return await applyTestFix(fixDetail);
    } catch (err) {
      setPipelineError(getApiErrorMessage(err));
      return null;
    }
  }, [onChange, runId]);

  const runTestsWithAutoFix = useCallback(async (): Promise<boolean> => {
    if (pipelineRunningRef.current) return false;
    pipelineRunningRef.current = true;
    setPipelineError(null);
    setTestRunning(true);

    try {
      let current = await runTestsOnce();
      if (current.test?.ok) return true;
      if (!hasFailedChecks(current.test)) return false;

      for (let attempt = 0; attempt < MAX_FIX_ATTEMPTS; attempt++) {
        if (current.test?.ok) return true;
        if (!hasFailedChecks(current.test)) break;

        setTestRunning(false);
        setTestFixing(true);

        try {
          const fixed = await runFixCycle();
          if (!fixed) return false;
          current = fixed;
        } finally {
          setTestFixing(false);
          setTestRunning(true);
        }

        current = await runTestsOnce();
        if (current.test?.ok) return true;
      }

      if (!current.test?.ok) {
        setPipelineError('Some checks still failing after AI fix attempts. Review the output below.');
      }
      return current.test?.ok === true;
    } catch (err) {
      setPipelineError(getApiErrorMessage(err));
      return false;
    } finally {
      pipelineRunningRef.current = false;
      setTestRunning(false);
      setTestFixing(false);
    }
  }, [onChange, runId, runFixCycle]);

  const runVisualSmokeFix = useCallback(async (): Promise<boolean> => {
    if (pipelineRunningRef.current) return false;
    pipelineRunningRef.current = true;
    setPipelineError(null);
    setTestFixing(true);

    try {
      const fixed = await runFixCycle();
      if (!fixed) return false;

      setTestFixing(false);
      setTestRunning(true);
      const current = await runTestsOnce();
      return current.test?.ok === true;
    } catch (err) {
      setPipelineError(getApiErrorMessage(err));
      return false;
    } finally {
      pipelineRunningRef.current = false;
      setTestRunning(false);
      setTestFixing(false);
    }
  }, [onChange, runId, runFixCycle]);

  return {
    runTestsWithAutoFix,
    runVisualSmokeFix,
    hasVisualSmokeFailure: hasVisualSmokeFailure(detail.test),
    testRunning,
    testFixing,
    pipelineRunning: testRunning || testFixing,
    pipelineError,
    clearPipelineError: () => setPipelineError(null),
  };
}
