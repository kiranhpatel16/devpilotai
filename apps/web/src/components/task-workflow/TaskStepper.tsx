import type { TaskWorkflowStep } from '@cpwork/shared';
import { WORKFLOW_STEPS, canGoToStep } from './constants';

export function TaskStepper({
  currentStep,
  completedSteps,
  onNavigate,
  showHistory,
  onShowHistory,
}: {
  currentStep: TaskWorkflowStep;
  completedSteps: TaskWorkflowStep[];
  onNavigate: (step: TaskWorkflowStep) => void;
  showHistory?: boolean;
  onShowHistory?: () => void;
}) {
  return (
    <nav className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 pb-2 dark:border-neutral-800">
      {WORKFLOW_STEPS.map((step) => {
        const isCurrent = step.id === currentStep;
        const isCompleted = completedSteps.includes(step.id);
        const clickable = canGoToStep(completedSteps, currentStep, step.id);
        return (
          <button
            key={step.id}
            type="button"
            disabled={!clickable}
            onClick={() => clickable && onNavigate(step.id)}
            className={[
              'whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              isCurrent
                ? 'border-b-2 border-brand-600 text-brand-700 dark:text-brand-400'
                : isCompleted
                  ? 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-neutral-800'
                  : 'text-slate-300 dark:text-slate-600',
              !clickable ? 'cursor-not-allowed opacity-50' : '',
            ].join(' ')}
          >
            {step.label}
          </button>
        );
      })}
      {onShowHistory && (
        <button
          type="button"
          onClick={onShowHistory}
          className={[
            'ml-auto whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium',
            showHistory
              ? 'bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-300'
              : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-neutral-800',
          ].join(' ')}
        >
          History
        </button>
      )}
    </nav>
  );
}
