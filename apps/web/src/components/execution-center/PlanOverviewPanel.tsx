import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { taskBody, taskMuted, taskPanel, taskPanelHeader, taskTitle } from './taskStyles';

interface PlanOverviewPanelProps {
  planMarkdown: string | null;
  currentStep?: string;
  preStart?: boolean;
}

function parsePlanItems(
  markdown: string | null,
  preStart?: boolean,
): { text: string; done: boolean; active: boolean }[] {
  if (!markdown?.trim()) {
    if (preStart) {
      return [
        { text: 'Analyze requirements', done: false, active: true },
        { text: 'Generate implementation plan', done: false, active: false },
        { text: 'Apply code changes', done: false, active: false },
        { text: 'Run validation checks', done: false, active: false },
      ];
    }
    return [
      { text: 'Analyze requirements', done: true, active: false },
      { text: 'Generate implementation plan', done: false, active: true },
      { text: 'Apply code changes', done: false, active: false },
      { text: 'Run validation checks', done: false, active: false },
    ];
  }

  const lines = markdown
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*]\s/.test(l) || /^\d+\./.test(l));

  if (lines.length === 0) {
    return [{ text: 'Review generated plan', done: false, active: true }];
  }

  return lines.slice(0, 8).map((line, i) => {
    const text = line.replace(/^[-*\d.]+\s*/, '').trim();
    const done = line.includes('[x]') || line.includes('✓');
    return { text, done, active: !done && i === lines.findIndex((l) => !l.includes('[x]')) };
  });
}

export function PlanOverviewPanel({ planMarkdown, currentStep, preStart }: PlanOverviewPanelProps) {
  const items = parsePlanItems(planMarkdown, preStart);
  const isCoding = currentStep === 'agent';

  return (
    <div className={taskPanel}>
      <header className={taskPanelHeader}>
        <h3 className={taskTitle}>Plan Overview</h3>
      </header>
      <ul className="space-y-2.5 p-4">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            {item.done ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            ) : item.active || (isCoding && i === items.length - 1) ? (
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-brand-400" />
            ) : (
              <Circle className={`mt-0.5 h-4 w-4 shrink-0 ${taskMuted}`} />
            )}
            <span
              className={
                item.done
                  ? `${taskMuted} line-through`
                  : item.active
                    ? `font-medium text-white`
                    : taskBody
              }
            >
              {item.text}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
