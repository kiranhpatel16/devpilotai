import type { TestReport } from '@cpwork/shared';
import { CheckCircle2, Circle, XCircle } from 'lucide-react';
import { taskBody, taskMuted, taskPanel, taskPanelHeader, taskTitle } from './taskStyles';

interface ChecksPanelProps {
  test: TestReport | null;
}

const DEFAULT_CHECKS = [
  { key: 'php_lint', label: 'PHP Lint' },
  { key: 'static_analysis', label: 'Static Analysis' },
  { key: 'unit_tests', label: 'Unit Tests' },
  { key: 'magento_validate', label: 'Magento Validate' },
];

export function ChecksPanel({ test }: ChecksPanelProps) {
  const steps = test?.steps ?? [];

  return (
    <div className={taskPanel}>
      <header className={taskPanelHeader}>
        <h3 className={taskTitle}>Checks</h3>
      </header>
      <ul className="divide-y divide-slate-700/60 p-2">
        {(steps.length ? steps : DEFAULT_CHECKS.map((c) => ({ ...c, ok: false, skipped: true, output: '' }))).map(
          (step) => (
            <li key={step.key} className="flex items-center justify-between px-2 py-2.5">
              <span className={`text-sm ${taskBody}`}>{step.label}</span>
              {step.ok ? (
                <span className="flex items-center gap-1 text-xs font-medium text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" />
                  Passed
                </span>
              ) : step.skipped ? (
                <span className={`flex items-center gap-1 text-xs ${taskMuted}`}>
                  <Circle className="h-4 w-4" />
                  Pending
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs font-medium text-red-400">
                  <XCircle className="h-4 w-4" />
                  Failed
                </span>
              )}
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
