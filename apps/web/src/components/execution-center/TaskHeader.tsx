import type { RunDetail } from '@cpwork/shared';

interface TaskHeaderProps {
  detail: RunDetail | null;
  selectedKey: string | null;
  customTitle: string;
  custom: boolean;
  projectName: string;
  taskSummary?: string;
}

export function TaskHeader({
  detail,
  selectedKey,
  customTitle,
  custom,
  projectName,
  taskSummary,
}: TaskHeaderProps) {
  const key = detail?.run.jiraKey ?? selectedKey;
  const title =
    detail?.workflow?.jiraSnapshot?.summary ??
    taskSummary ??
    (custom ? customTitle : null) ??
    detail?.workflow?.customTitle;

  return (
    <div className="border-b border-surface-700 pb-4">
      <p className="text-xs text-slate-500">{projectName}</p>
      {key && <p className="font-mono text-lg font-bold text-brand-400">{key}</p>}
      {custom && !key && (
        <p className="text-lg font-bold text-brand-400">Custom Task</p>
      )}
      {title && <h1 className="mt-1 text-xl font-semibold text-white">{title}</h1>}
      {detail?.workflow && (
        <p className="mt-1 text-xs text-slate-500">
          Step: {detail.workflow.currentStep.replace(/_/g, ' ')}
        </p>
      )}
    </div>
  );
}
