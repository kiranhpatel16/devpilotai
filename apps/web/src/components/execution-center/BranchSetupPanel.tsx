import type { AiProviderInfo, Project } from '@cpwork/shared';
import { taskInput, taskMuted, taskPanel, taskPanelHeader, taskStrong, taskTitle } from './taskStyles';

interface BranchSetupPanelProps {
  project: Project;
  providers: AiProviderInfo[];
  branchName: string;
  provider: string;
  model: string;
  onBranchNameChange: (value: string) => void;
  onProviderChange: (value: string) => void;
  onModelChange: (value: string) => void;
  readOnly?: boolean;
}

export function BranchSetupPanel({
  project,
  providers,
  branchName,
  provider,
  model,
  onBranchNameChange,
  onProviderChange,
  onModelChange,
  readOnly,
}: BranchSetupPanelProps) {
  const activeProvider = providers.find((p) => p.id === provider) ?? providers[0];

  return (
    <div className={taskPanel}>
      <header className={taskPanelHeader}>
        <h3 className={taskTitle}>Branch &amp; AI setup</h3>
      </header>
      <div className="space-y-4 p-4">
        <div>
          <label className={`label ${taskMuted}`}>Branch name</label>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className={`text-xs ${taskMuted}`}>
              from <code className={taskStrong}>{project.git.productionBranch}</code> →
            </span>
            <input
              className={`${taskInput} max-w-md font-mono`}
              value={branchName}
              onChange={(e) => onBranchNameChange(e.target.value)}
              readOnly={readOnly}
              disabled={readOnly}
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={`label ${taskMuted}`}>AI provider</label>
            <select
              className={taskInput}
              value={provider}
              onChange={(e) => onProviderChange(e.target.value)}
              disabled={readOnly}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={`label ${taskMuted}`}>Model</label>
            <select
              className={taskInput}
              value={model || activeProvider?.defaultModel || ''}
              onChange={(e) => onModelChange(e.target.value)}
              disabled={readOnly}
            >
              {activeProvider?.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
