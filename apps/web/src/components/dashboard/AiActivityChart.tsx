import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTheme } from '../../theme/ThemeContext';
import { app, getChartTheme } from '../../theme/tokens';

interface AiActivityChartProps {
  data: {
    day: string;
    files: number;
    loc: number;
    tests: number;
    prs: number;
    commits: number;
  }[];
}

export function AiActivityChart({ data }: AiActivityChartProps) {
  const { theme } = useTheme();
  const chart = getChartTheme(theme === 'dark');

  return (
    <div className="card p-4">
      <h3 className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">
        AI Activity (7 days)
      </h3>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
            <XAxis dataKey="day" stroke={chart.axis} fontSize={11} />
            <YAxis stroke={chart.axis} fontSize={11} />
            <Tooltip
              contentStyle={{
                background: chart.tooltipBg,
                border: `1px solid ${chart.tooltipBorder}`,
                borderRadius: 12,
                color: chart.tooltipText,
              }}
            />
            <Legend />
            <Line type="monotone" dataKey="files" stroke={app.accent} strokeWidth={2} dot={false} name="Files" />
            <Line type="monotone" dataKey="tests" stroke="#10B981" strokeWidth={2} dot={false} name="Tests" />
            <Line type="monotone" dataKey="prs" stroke="#F59E0B" strokeWidth={2} dot={false} name="PRs" />
            <Line type="monotone" dataKey="commits" stroke="#06B6D4" strokeWidth={2} dot={false} name="Commits" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
