import { useState } from 'react';
import type { RunDetail } from '@cpwork/shared';
import { DiffView } from '../DiffView';
import {
  fileActionBadgeClass,
  fileListItemClass,
  filePathTextClass,
  taskBody,
  taskDivider,
  taskMuted,
  taskPanel,
  taskPanelHeader,
  taskSurface,
  taskTitle,
} from './taskStyles';

interface FilesChangedPanelProps {
  detail: RunDetail | null;
  compact?: boolean;
  showDiff?: boolean;
  title?: string;
}

function statusBadgeLabel(action: string): string {
  const a = action.toLowerCase();
  if (a === 'create') return 'A';
  if (a === 'delete') return 'D';
  return 'M';
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
  const activePath = selectedPath ?? files[0]?.path ?? null;
  const selectedDiff = diffs.find((d) => d.path === activePath) ?? diffs[0];
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
            {title ?? 'Files Changed'} ({files.length})
          </h3>
        </header>
        <ul className="max-h-48 overflow-y-auto p-2">
          {files.map((f) => {
            const isActive = activePath === f.path;
            return (
              <li key={f.path}>
                <button
                  type="button"
                  onClick={() => setSelectedPath(f.path)}
                  className={fileListItemClass(isActive)}
                  aria-current={isActive ? 'true' : undefined}
                >
                  <span className={fileActionBadgeClass(f.action ?? 'modify', isActive)}>
                    {statusBadgeLabel(f.action ?? 'modify')}
                  </span>
                  <span className={filePathTextClass(isActive)}>{f.path}</span>
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
          <div className="flex rounded-md border border-slate-300 p-0.5 text-xs dark:border-neutral-600">
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
      <div className="grid max-h-80 grid-cols-[minmax(160px,1fr)_2fr] overflow-hidden">
        <ul className={`overflow-y-auto border-r ${taskDivider} p-2`}>
          {files.map((f) => {
            const isActive = activePath === f.path;
            const fileName = f.path.split('/').pop() ?? f.path;
            return (
              <li key={f.path}>
                <button
                  type="button"
                  onClick={() => setSelectedPath(f.path)}
                  className={fileListItemClass(isActive)}
                  title={f.path}
                  aria-current={isActive ? 'true' : undefined}
                >
                  <span className={fileActionBadgeClass(f.action ?? 'modify', isActive)}>
                    {statusBadgeLabel(f.action ?? 'modify')}
                  </span>
                  <span className={filePathTextClass(isActive)}>{fileName}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className={`overflow-auto ${taskSurface} p-2`}>
          {activePath && (
            <p className={`mb-2 truncate font-mono text-[10px] ${taskBody}`}>{activePath}</p>
          )}
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
