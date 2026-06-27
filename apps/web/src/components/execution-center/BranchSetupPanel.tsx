import type { AiProviderInfo, DevAgentId, Project } from '@cpwork/shared';
import { providerSetupHint } from '../../lib/aiProviderHints';
import { taskInput, taskMuted, taskPanel, taskPanelHeader, taskStrong, taskTitle } from './taskStyles';

interface AiRoleCardProps {
  title: string;
  description: string;
  footer: string;
  providers: AiProviderInfo[];
  provider: string;
  model: string;
  onProviderChange: (value: string) => void;
  onModelChange: (value: string) => void;
  readOnly?: boolean;
  purpose: 'planning' | 'coding';
}

function AiRoleCard({
  title,
  description,
  footer,
  providers,
  provider,
  model,
  onProviderChange,
  onModelChange,
  readOnly,
  purpose,
}: AiRoleCardProps) {
  const activeProvider = providers.find((p) => p.id === provider) ?? providers[0];
  const effectiveModel = model || activeProvider?.defaultModel || '';
  const hint = providerSetupHint(provider, effectiveModel, providers, purpose);

  return (
    <div className="space-y-3 rounded-lg border border-slate-200/80 bg-slate-50/50 p-3 dark:border-neutral-700/60 dark:bg-neutral-900/40">
      <div>
        <h4 className={`text-sm font-medium ${taskStrong}`}>{title}</h4>
        <p className={`mt-0.5 text-xs leading-relaxed ${taskMuted}`}>{description}</p>
      </div>
      <div className="space-y-2">
        <div>
          <label className={`label ${taskMuted}`}>Provider</label>
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
            value={effectiveModel}
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
      {hint && (
        <p className={`rounded-md border border-brand-500/20 bg-brand-500/5 px-2.5 py-2 text-[11px] leading-relaxed ${taskMuted}`}>
          {hint}
        </p>
      )}
      <p className={`text-[10px] leading-relaxed ${taskMuted}`}>{footer}</p>
    </div>
  );
}

interface BranchSetupPanelProps {
  project: Project;
  providers: AiProviderInfo[];
  branchName: string;
  planningProvider: string;
  planningModel: string;
  codingProvider: string;
  codingModel: string;
  devAgentId?: DevAgentId;
  devAgents?: { id: DevAgentId; label: string }[];
  onBranchNameChange: (value: string) => void;
  onPlanningProviderChange: (value: string) => void;
  onPlanningModelChange: (value: string) => void;
  onCodingProviderChange: (value: string) => void;
  onCodingModelChange: (value: string) => void;
  onDevAgentChange?: (value: DevAgentId) => void;
  readOnly?: boolean;
}

export function BranchSetupPanel({
  project,
  providers,
  branchName,
  planningProvider,
  planningModel,
  codingProvider,
  codingModel,
  onBranchNameChange,
  onPlanningProviderChange,
  onPlanningModelChange,
  onCodingProviderChange,
  onCodingModelChange,
  devAgentId = 'magento',
  devAgents,
  onDevAgentChange,
  readOnly,
}: BranchSetupPanelProps) {
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

        <div className="grid gap-3 lg:grid-cols-2">
          <AiRoleCard
            title="Planning AI"
            description="Requirement analysis, architecture, and implementation plan."
            footer="Used for requirement validation, planning, and code review — not file edits."
            providers={providers}
            provider={planningProvider}
            model={planningModel}
            onProviderChange={(id) => {
              onPlanningProviderChange(id);
              const next = providers.find((p) => p.id === id);
              onPlanningModelChange(next?.defaultModel ?? '');
            }}
            onModelChange={onPlanningModelChange}
            readOnly={readOnly}
            purpose="planning"
          />
          <AiRoleCard
            title="Coding AI"
            description="Implements the approved plan — edits files directly when using Cursor SDK."
            footer="Cursor SDK edits files directly on your project path. Best for multi-file Magento implementations."
            providers={providers}
            provider={codingProvider}
            model={codingModel}
            onProviderChange={(id) => {
              onCodingProviderChange(id);
              const next = providers.find((p) => p.id === id);
              onCodingModelChange(next?.defaultModel ?? '');
            }}
            onModelChange={onCodingModelChange}
            readOnly={readOnly}
            purpose="coding"
          />
        </div>

        {devAgents && devAgents.length > 0 && onDevAgentChange && (
          <div>
            <label className={`label ${taskMuted}`}>Development agent</label>
            <select
              className={taskInput}
              value={devAgentId}
              onChange={(e) => onDevAgentChange(e.target.value as DevAgentId)}
              disabled={readOnly}
            >
              {devAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}
