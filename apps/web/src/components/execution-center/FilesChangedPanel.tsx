import { useState } from 'react';
import type { RunDetail } from '@cpwork/shared';
import { DiffView } from '../DiffView';
import { taskDivider, taskMuted, taskPanel, taskPanelHeader, taskSurface, taskTitle } from './taskStyles';

interface FilesChangedPanelProps {
  detail: RunDetail | null;
  compact?: boolean;
  showDiff?: boolean;
  title?: string;
}

function statusBadge(action: string) {
  const a = action.toLowerCase();
  if (a === 'create') return { label: 'A', className: 'bg-emerald-500/20 text-emerald-400' };
  if (a === 'delete') return { label: 'D', className: 'bg-red-500/20 text-red-400' };
  return { label: 'M', className: 'bg-brand-600/20 text-brand-300' };
}

function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <div className={taskPanel}>
      <header className={taskPanelHeader}>
        <h3 className={taskTitle}>{title}</h3>
      </header>
      <p className={`p-4 text-sm ${taskMuted}`}>{message}</p>
    </div>
  );
}

export function FilesChangedPanel({
  detail,
  compact,
  showDiff = true,
  title,
}: FilesChangedPanelProps) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'diff' | 'file'>('diff');

  const files = detail?.output?.files ?? [];
  const diffs = detail?.diffs ?? [];
  const selectedDiff = diffs.find((d) => d.path === selectedPath) ?? diffs[0];
  const panelTitle = title ?? (showDiff ? 'Code Changes' : 'Files Changed');

  if (!detail || files.length === 0) {
    return (
      <EmptyState
        title={panelTitle}
        message={showDiff ? 'No code changes yet.' : 'No file changes yet.'}
      />
    );
  }

  if (compact) {
    return (
      <div className={taskPanel}>
        <header className={taskPanelHeader}>
          <h3 className={taskTitle}>
            Files Changed ({files.length})
          </h3>
        </header>
        <ul className="max-h-48 overflow-y-auto p-2">
          {files.map((f) => {
            const badge = statusBadge(f.action ?? 'modify');
            return (
              <li key={f.path}>
                <button
                  type="button"
                  onClick={() => setSelectedPath(f.path)}
                  className={[
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left font-mono text-xs',
                    selectedPath === f.path || (!selectedPath && f === files[0])
                      ? 'bg-brand-600/20 text-brand-700 dark:text-brand-300'
                      : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-neutral-900',
                  ].join(' ')}
                >
                  <span className={`rounded px-1 text-[10px] font-bold ${badge.className}`}>
                    {badge.label}
                  </span>
                  <span className="truncate">{f.path}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  return (
    <div className={`${taskPanel} overflow-hidden`}>
      <header className={`${taskPanelHeader} flex items-center justify-between`}>
        <h3 className={taskTitle}>{panelTitle}</h3>
        {showDiff && (
          <div className="flex rounded-md border border-slate-600 p-0.5 text-xs">
            <button
              type="button"
              className={
                viewMode === 'diff'
                  ? 'rounded bg-brand-600 px-2 py-0.5 text-white'
                  : `px-2 py-0.5 ${taskMuted}`
              }
              onClick={() => setViewMode('diff')}
            >
              Diff
            </button>
            <button
              type="button"
              className={
                viewMode === 'file'
                  ? 'rounded bg-brand-600 px-2 py-0.5 text-white'
                  : `px-2 py-0.5 ${taskMuted}`
              }
              onClick={() => setViewMode('file')}
            >
              File
            </button>
          </div>
        )}
      </header>
      <div className="grid max-h-80 grid-cols-[minmax(140px,1fr)_2fr] overflow-hidden">
        <ul className={`overflow-y-auto border-r ${taskDivider} p-2`}>
          {files.map((f) => {
            const badge = statusBadge(f.action ?? 'modify');
            return (
              <li key={f.path}>
                <button
                  type="button"
                  onClick={() => setSelectedPath(f.path)}
                  className={[
                    'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left font-mono text-xs',
                    (selectedPath ?? files[0]?.path) === f.path
                      ? 'bg-brand-600/20 text-brand-700 dark:text-brand-300'
                      : 'text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-neutral-900',
                  ].join(' ')}
                >
                  <span className={`rounded px-1 text-[10px] font-bold ${badge.className}`}>
                    {badge.label}
                  </span>
                  <span className="truncate">{f.path.split('/').pop()}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className={`overflow-auto ${taskSurface} p-2`}>
          {selectedDiff && showDiff ? (
            <DiffView diff={selectedDiff} />
          ) : (
            <p className={`text-xs ${taskMuted}`}>Select a file to view diff</p>
          )}
        </div>
      </div>
    </div>
  );
}
