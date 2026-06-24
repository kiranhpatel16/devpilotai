import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { useTheme } from '../../theme/ThemeContext';
import { getChartTheme } from '../../theme/tokens';

interface TaskStatusDonutProps {
  data: { name: string; value: number; color: string }[];
  total?: number;
  title?: string;
}

export function TaskStatusDonut({ data, total, title = 'Task Progress' }: TaskStatusDonutProps) {
  const { theme } = useTheme();
  const chart = getChartTheme(theme === 'dark');
  const filtered = data.filter((d) => d.value > 0);
  const sum = total ?? filtered.reduce((a, b) => a + b.value, 0);

  return (
    <div className="card p-4">
      <h3 className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">{title}</h3>
      <div className="flex items-center gap-4">
        <div className="relative h-36 w-36 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={filtered.length ? filtered : [{ name: 'Empty', value: 1, color: chart.track }]}
                dataKey="value"
                innerRadius={42}
                outerRadius={60}
                paddingAngle={2}
              >
                {(filtered.length ? filtered : [{ color: chart.track }]).map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  background: chart.tooltipBg,
                  border: `1px solid ${chart.tooltipBorder}`,
                  borderRadius: 12,
                  color: chart.tooltipText,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">{sum}</span>
            <span className="text-xs text-slate-500">Total</span>
          </div>
        </div>
        <ul className="min-w-0 flex-1 space-y-1.5 text-xs">
          {data.map((d) => (
            <li key={d.name} className="grid w-full grid-cols-[1fr_auto] items-center gap-3">
              <span className="flex min-w-0 items-center gap-2 text-slate-500">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: d.color }} />
                <span className="truncate">{d.name}</span>
              </span>
              <span className="font-medium tabular-nums text-slate-800 dark:text-slate-200">{d.value}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
