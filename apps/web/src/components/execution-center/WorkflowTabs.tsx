import { Check } from 'lucide-react';
import type { TaskWorkflowStep } from '@cpwork/shared';
import { taskMuted } from './taskStyles';

export type WorkflowTab =
  | 'requirements'
  | 'plan'
  | 'code'
  | 'review'
  | 'tests'
  | 'pr'
  | 'deploy';

const TABS: { id: WorkflowTab; label: string; short: string; steps: TaskWorkflowStep[] }[] = [
  { id: 'requirements', label: 'Requirements', short: 'Req', steps: ['select', 'branch', 'describe'] },
  { id: 'plan', label: 'Plan', short: 'Plan', steps: ['plan', 'review_plan'] },
  { id: 'code', label: 'Code', short: 'Code', steps: ['agent'] },
  { id: 'review', label: 'Review', short: 'Review', steps: ['code_review'] },
  { id: 'tests', label: 'Tests', short: 'Tests', steps: ['deploy'] },
  { id: 'pr', label: 'PR', short: 'PR', steps: ['commit'] },
  { id: 'deploy', label: 'Deploy', short: 'Deploy', steps: ['jira_comment', 'done'] },
];

interface WorkflowTabsProps {
  currentStep?: TaskWorkflowStep | null;
  activeTab: WorkflowTab;
  onTabChange: (tab: WorkflowTab) => void;
  preStart?: boolean;
}

function stepToTab(step: TaskWorkflowStep): WorkflowTab {
  for (const t of TABS) {
    if (t.steps.includes(step)) return t.id;
  }
  return 'requirements';
}

function tabIndex(tab: WorkflowTab): number {
  return TABS.findIndex((t) => t.id === tab);
}

export function getTabForStep(step: TaskWorkflowStep): WorkflowTab {
  return stepToTab(step);
}

export function WorkflowTabs({
  currentStep,
  activeTab,
  onTabChange,
  preStart,
}: WorkflowTabsProps) {
  const currentTab = preStart || !currentStep ? 'requirements' : stepToTab(currentStep);
  const currentIdx = tabIndex(currentTab);

  return (
    <nav
      className="overflow-x-auto rounded-lg border border-slate-700/60 bg-[#0f0f1a] px-2 py-2"
      aria-label="Workflow progress"
    >
      <ol className="flex min-w-max items-center gap-0.5">
        {TABS.map((t, i) => {
          const isComplete = !preStart && i < currentIdx;
          const isCurrent = currentTab === t.id;
          const isActive = activeTab === t.id;
          const canNavigate = isComplete || isCurrent;

          return (
            <li key={t.id} className="flex items-center">
              <button
                type="button"
                disabled={!canNavigate && !preStart}
                onClick={() => canNavigate && onTabChange(t.id)}
                className={[
                  'flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors sm:px-3',
                  isActive
                    ? 'bg-brand-600/20 text-brand-300'
                    : canNavigate
                      ? 'text-slate-300 hover:bg-slate-800'
                      : 'cursor-default text-slate-600',
                ].join(' ')}
              >
                <span
                  className={[
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                    isComplete
                      ? 'bg-brand-600 text-white'
                      : isCurrent
                        ? 'bg-brand-600 text-white ring-2 ring-brand-500/40'
                        : 'border border-slate-600 bg-[#1a1a2e] text-slate-500',
                  ].join(' ')}
                >
                  {isComplete ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <span className="hidden text-xs font-medium sm:inline">{t.label}</span>
                <span className="text-xs font-medium sm:hidden">{t.short}</span>
                {isCurrent && (
                  <span className="hidden text-[10px] text-brand-400/80 md:inline">· active</span>
                )}
              </button>
              {i < TABS.length - 1 && (
                <div
                  className={[
                    'mx-0.5 h-px w-3 sm:w-5',
                    isComplete ? 'bg-brand-600' : 'bg-slate-700',
                  ].join(' ')}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
