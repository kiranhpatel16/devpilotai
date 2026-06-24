import { CheckCircle2, Circle } from 'lucide-react';
import { taskBody, taskMuted, taskPanel, taskPanelHeader, taskTitle } from './taskStyles';

const DEFAULT_CRITERIA = [
  'Admin grid displays payment error logs',
  'Filters work for date range and status',
  'Export to CSV is available',
  'Magento coding standards followed',
];

interface AcceptanceCriteriaPanelProps {
  items?: string[];
}

export function AcceptanceCriteriaPanel({ items = DEFAULT_CRITERIA }: AcceptanceCriteriaPanelProps) {
  return (
    <div className={taskPanel}>
      <header className={taskPanelHeader}>
        <h3 className={taskTitle}>Acceptance Criteria</h3>
      </header>
      <ul className="space-y-2 p-4">
        {items.map((text, i) => (
          <li key={i} className={`flex items-start gap-2 text-sm ${taskBody}`}>
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <span>{text}</span>
          </li>
        ))}
        {items.length === 0 && (
          <li className={`flex items-center gap-2 text-sm ${taskMuted}`}>
            <Circle className="h-4 w-4" />
            No acceptance criteria defined
          </li>
        )}
      </ul>
    </div>
  );
}
