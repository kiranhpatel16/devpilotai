import { CheckCircle2 } from 'lucide-react';
import { taskBody, taskPanel, taskPanelHeader, taskTitle } from './taskStyles';

interface AcceptanceCriteriaPanelProps {
  items: string[];
}

export function AcceptanceCriteriaPanel({ items }: AcceptanceCriteriaPanelProps) {
  if (items.length === 0) return null;

  return (
    <div className={taskPanel}>
      <header className={taskPanelHeader}>
        <h3 className={taskTitle}>Acceptance Criteria</h3>
      </header>
      <ul className="space-y-2 p-4">
        {items.map((text) => (
          <li key={text} className={`flex items-start gap-2 text-sm ${taskBody}`}>
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <span>{text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
