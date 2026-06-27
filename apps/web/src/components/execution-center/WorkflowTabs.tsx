import { Check } from 'lucide-react';
import type { RunDetail, TaskWorkflowStep } from '@cpwork/shared';
import { migrateStep } from '../task-workflow/constants';
import { taskAccent, taskMuted, taskSurface } from './taskStyles';

export type WorkflowTab =
  | 'requirements'
  | 'setup'
  | 'plan'
  | 'code'
  | 'build'
  | 'review'
  | 'pr'
  | 'qa'
  | 'jira'
  | 'done';

const TABS: { id: WorkflowTab; label: string; short: string; steps: TaskWorkflowStep[] }[] = [
  { id: 'requirements', label: 'Analysis', short: 'Req', steps: ['requirement_analysis'] },
  { id: 'setup', label: 'Setup', short: 'Setup', steps: ['environment_setup', 'branch', 'describe'] },
  {
    id: 'plan',
    label: 'Plan & Approval',
    short: 'Plan',
    steps: [
      'architecture_design',
      'development_plan',
      'test_cases',
      'plan',
      'pre_dev_approval',
      'review_plan',
    ],
  },
  { id: 'code', label: 'Code', short: 'Code', steps: ['agent'] },
  { id: 'review', label: 'Review', short: 'Rev', steps: ['code_review'] },
  { id: 'build', label: 'Build', short: 'Build', steps: ['deploy'] },
  { id: 'pr', label: 'PR', short: 'PR', steps: ['commit'] },
  { id: 'qa', label: 'QA', short: 'QA', steps: ['qa'] },
  { id: 'jira', label: 'Jira', short: 'Jira', steps: ['jira_comment'] },
  { id: 'done', label: 'Done', short: 'Done', steps: ['done'] },
];

interface WorkflowTabsProps {
  currentStep?: TaskWorkflowStep | null;
  activeTab: WorkflowTab;
  onTabChange: (tab: WorkflowTab) => void;
  preStart?: boolean;
  detail?: RunDetail | null;
}

function stepToTab(step: TaskWorkflowStep): WorkflowTab {
  const migrated = migrateStep(step);
  for (const t of TABS) {
    if (t.steps.some((s) => migrateStep(s) === migrated)) return t.id;
  }
  if (migrated === 'select') return 'requirements';
  return 'requirements';
}

/** Map legacy tab ids from saved UI state. */
export function normalizeWorkflowTab(tab: string): WorkflowTab {
  if (tab === 'design' || tab === 'approval') return 'plan';
  if (tab === 'jira_comment') return 'jira';
  return tab as WorkflowTab;
}

function tabIndex(tab: WorkflowTab): number {
  return TABS.findIndex((t) => t.id === tab);
}

export function getTabForStep(step: TaskWorkflowStep): WorkflowTab {
  return stepToTab(step);
}

/** Pick the best tab for the current run state (not just workflow step). */
export function resolveWorkflowTab(detail: RunDetail | null | undefined): WorkflowTab {
  const step = detail?.workflow?.currentStep;
  if (!step) return 'requirements';
  const migrated = migrateStep(step);
  const hasCodegen = !!(detail?.output?.files?.length);
  const applied = !!detail?.applied;
  const gen = detail?.workflow?.agentGeneration;

  if (
    detail?.run.status === 'analyzing' ||
    gen?.status === 'running' ||
    (migrated === 'agent' && !hasCodegen)
  ) {
    return 'code';
  }
  if (hasCodegen && !applied && migrated === 'code_review') {
    return 'code';
  }
  return stepToTab(step);
}

export function WorkflowTabs({
  currentStep,
  activeTab,
  onTabChange,
  preStart,
  detail,
}: WorkflowTabsProps) {
  const currentTab =
    preStart || !currentStep
      ? 'requirements'
      : detail
        ? resolveWorkflowTab(detail)
        : stepToTab(currentStep);
  const currentIdx = tabIndex(currentTab);

  return (
    <nav
      className={`overflow-x-auto ${taskSurface} px-2 py-2`}
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
                  'flex items-center gap-1.5 rounded-md px-2 py-1.5 transition-colors sm:px-2.5',
                  isActive
                    ? 'bg-brand-600/20 text-brand-700 dark:text-brand-300'
                    : canNavigate
                      ? 'text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-neutral-900'
                      : 'cursor-default text-slate-400 dark:text-slate-600',
                ].join(' ')}
              >
                <span
                  className={[
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                    isComplete
                      ? 'bg-brand-600 text-white'
                      : isCurrent
                        ? 'bg-brand-600 text-white ring-2 ring-brand-500/40'
                        : 'border border-slate-300 bg-white text-slate-400 dark:border-neutral-700 dark:bg-[#111111] dark:text-slate-500',
                  ].join(' ')}
                >
                  {isComplete ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <span className="hidden text-xs font-medium lg:inline">{t.label}</span>
                <span className="text-xs font-medium lg:hidden">{t.short}</span>
                {isCurrent && (
                  <span className={`hidden text-[10px] ${taskAccent} opacity-80 xl:inline`}>· active</span>
                )}
              </button>
              {i < TABS.length - 1 && (
                <div
                  className={[
                    'mx-0.5 h-px w-2 sm:w-3',
                    isComplete ? 'bg-brand-600' : 'bg-slate-300 dark:bg-neutral-800',
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
