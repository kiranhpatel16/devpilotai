import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { useTheme } from '../../theme/ThemeContext';
import { app } from '../../theme/tokens';

interface MetricSparkCardProps {
  label: string;
  value: string | number;
  delta?: string;
  deltaPositive?: boolean;
  data?: { v: number }[];
  color?: string;
  icon?: React.ReactNode;
}

export function MetricSparkCard({
  label,
  value,
  delta,
  deltaPositive = true,
  data = [{ v: 3 }, { v: 5 }, { v: 4 }, { v: 7 }, { v: 6 }, { v: 8 }, { v: 9 }],
  color,
  icon,
}: MetricSparkCardProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const chartColor = color ?? (isDark ? app.accentLight : app.accent);

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        {icon && <div className="app-icon-circle h-9 w-9 shrink-0">{icon}</div>}
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div>
          <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</p>
          {delta && (
            <p
              className={`text-xs font-medium ${
                deltaPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'
              }`}
            >
              {delta}
            </p>
          )}
        </div>
        <div className="h-10 w-20">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <Area
                type="monotone"
                dataKey="v"
                stroke={chartColor}
                fill={chartColor}
                fillOpacity={0.2}
                strokeWidth={2}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
