import type { RunDetail } from '@cpwork/shared';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';
import { taskBody, taskMuted, taskPanel, taskPanelHeader, taskTitle } from './taskStyles';

interface ProgressPanelProps {
  detail?: RunDetail | null;
  preStart?: boolean;
}

function computeProgress(detail: RunDetail | null | undefined, preStart?: boolean): number {
  if (preStart || !detail?.workflow) return 0;
  const total = 11;
  const completed = detail.workflow.completedSteps.length;
  return Math.min(100, Math.round((completed / total) * 100));
}

export function ProgressPanel({ detail, preStart }: ProgressPanelProps) {
  const pct = preStart ? 0 : computeProgress(detail);
  const data = [
    { name: 'done', value: pct || 1, color: '#7c3aed' },
    { name: 'remaining', value: 100 - (pct || 1), color: '#2d2e3a' },
  ];

  const started = detail?.run.createdAt;
  const elapsed = started
    ? Math.round((Date.now() - new Date(started).getTime()) / 60_000)
    : 0;

  return (
    <div className={taskPanel}>
      <header className={taskPanelHeader}>
        <h3 className={taskTitle}>Progress</h3>
      </header>
      <div className="flex items-center gap-4 p-4">
        <div className="relative h-28 w-28 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                innerRadius={32}
                outerRadius={48}
                startAngle={90}
                endAngle={-270}
                strokeWidth={0}
              >
                {data.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className={`text-xl font-bold ${taskTitle}`}>{pct}%</span>
          </div>
        </div>
        <div className="flex-1 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className={taskMuted}>Estimated</span>
            <span className={`font-medium ${taskTitle}`}>~2h</span>
          </div>
          <div className="flex justify-between">
            <span className={taskMuted}>Elapsed</span>
            <span className={`font-medium ${taskTitle}`}>{elapsed}m</span>
          </div>
          <div className="flex justify-between">
            <span className={taskMuted}>Provider</span>
            <span className={`font-medium ${taskBody}`}>{detail?.run.provider ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className={taskMuted}>Model</span>
            <span className={`font-medium ${taskBody}`}>{detail?.run.model ?? '—'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
