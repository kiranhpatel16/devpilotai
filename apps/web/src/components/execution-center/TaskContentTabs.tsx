import { taskAccent, taskDivider, taskMuted } from './taskStyles';

export type TaskContentTab = 'details' | 'plan' | 'files' | 'code' | 'activity';

const TABS: { id: TaskContentTab; label: string }[] = [
  { id: 'details', label: 'Details' },
  { id: 'plan', label: 'Plan Overview' },
  { id: 'files', label: 'Files Changed' },
  { id: 'code', label: 'Code Changes' },
  { id: 'activity', label: 'Activity Feed' },
];

interface TaskContentTabsProps {
  active: TaskContentTab;
  onChange: (tab: TaskContentTab) => void;
}

export function TaskContentTabs({ active, onChange }: TaskContentTabsProps) {
  return (
    <nav className={`flex flex-wrap gap-1 border-b ${taskDivider}`} aria-label="Task content">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onChange(t.id)}
          className={[
            'relative px-4 py-2.5 text-sm font-medium transition-colors',
            active === t.id
              ? `${taskAccent} after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-brand-500`
              : `${taskMuted} hover:text-slate-700 dark:hover:text-slate-300`,
          ].join(' ')}
        >
          {t.label}
        </button>
      ))}
    </nav>
  );
}
