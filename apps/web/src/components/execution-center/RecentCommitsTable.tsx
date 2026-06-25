import { useQuery } from '@tanstack/react-query';
import type { GitCommitRow } from '@cpwork/shared';
import { GitCommit } from 'lucide-react';
import { api } from '../../lib/api';
import { taskAccent, taskBody, taskDivider, taskMuted, taskPanel, taskPanelHeader, taskSurface, taskTitle } from './taskStyles';

interface RecentCommitsTableProps {
  runId: string | null;
  branchName: string | null;
}

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    if (diff < 86_400_000) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}

export function RecentCommitsTable({ runId, branchName }: RecentCommitsTableProps) {
  const commitsQ = useQuery({
    queryKey: ['workflow-commits', runId],
    queryFn: async () =>
      runId
        ? (await api.get<{ commits: GitCommitRow[]; branch: string | null }>(
            `/workflow/runs/${runId}/commits`,
          )).data
        : { commits: [], branch: null },
    enabled: !!runId,
    refetchInterval: 30_000,
  });

  const commits = commitsQ.data?.commits ?? [];
  const branch = branchName ?? commitsQ.data?.branch;

  return (
    <div className={`${taskPanel} overflow-hidden`}>
      <header className={`${taskPanelHeader} flex items-center gap-2`}>
        <GitCommit className={`h-4 w-4 ${taskMuted}`} />
        <h3 className={taskTitle}>Recent Commits</h3>
        {branch && (
          <span className={`ml-auto font-mono text-xs ${taskMuted}`}>{branch}</span>
        )}
      </header>
      {commitsQ.isLoading && (
        <p className={`p-4 text-sm ${taskMuted}`}>Loading commits…</p>
      )}
      {!commitsQ.isLoading && commits.length === 0 && (
        <p className={`p-4 text-sm ${taskMuted}`}>No commits on this branch yet.</p>
      )}
      {commits.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className={`border-b ${taskDivider} ${taskSurface} text-left text-xs ${taskMuted}`}>
                <th className="px-4 py-2 font-medium">Hash</th>
                <th className="px-4 py-2 font-medium">Message</th>
                <th className="px-4 py-2 font-medium">Author</th>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium text-right">+/−</th>
              </tr>
            </thead>
            <tbody>
              {commits.map((c) => (
                <tr key={c.fullHash} className={`border-b border-slate-200/80 dark:border-neutral-800/40`}>
                  <td className={`px-4 py-2.5 font-mono text-xs ${taskAccent}`}>{c.hash}</td>
                  <td className={`max-w-xs truncate px-4 py-2.5 ${taskBody}`}>{c.message}</td>
                  <td className={`px-4 py-2.5 ${taskMuted}`}>{c.author ?? '—'}</td>
                  <td className={`px-4 py-2.5 ${taskMuted}`}>{formatWhen(c.when)}</td>
                  <td className="px-4 py-2.5 text-right text-xs">
                    <span className="text-emerald-400">+{c.added}</span>
                    {' / '}
                    <span className="text-red-400">−{c.removed}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
