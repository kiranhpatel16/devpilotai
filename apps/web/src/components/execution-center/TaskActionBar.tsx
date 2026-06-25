import { Link } from 'react-router-dom';
import type { RunDetail } from '@cpwork/shared';
import { ArrowLeft, ExternalLink, MoreVertical, Pause, Play, XCircle } from 'lucide-react';
import { StatusBadge } from '../ui/StatusBadge';
import { taskAccent, taskAccentHover, taskBtnDanger, taskBtnGhost, taskBtnPrimary, taskHeading, taskIconBtn, taskMuted } from './taskStyles';

interface TaskActionBarProps {
  projectId: string;
  detail: RunDetail | null;
  selectedKey: string | null;
  customTitle: string;
  custom: boolean;
  taskSummary?: string;
  jiraUrl?: string | null;
  statusLabel?: string;
  pausePending?: boolean;
  cancelPending?: boolean;
  startPending?: boolean;
  onPause?: () => void;
  onCancel?: () => void;
  onStart?: () => void;
  onShowHistory?: () => void;
  onStartCustom?: () => void;
  canStart?: boolean;
}

export function TaskActionBar({
  projectId,
  detail,
  selectedKey,
  customTitle,
  custom,
  taskSummary,
  jiraUrl: jiraUrlProp,
  statusLabel,
  pausePending,
  cancelPending,
  startPending,
  onPause,
  onCancel,
  onStart,
  onShowHistory,
  onStartCustom,
  canStart,
}: TaskActionBarProps) {
  const key = detail?.run.jiraKey ?? selectedKey;
  const customKey = detail?.workflow?.customTaskKey?.trim();
  const title =
    detail?.workflow?.jiraSnapshot?.summary ??
    taskSummary ??
    (custom ? customTitle : null) ??
    detail?.workflow?.customTitle;

  const jiraUrl =
    jiraUrlProp ??
    detail?.workflow?.jiraSnapshot?.url ??
    undefined;
  const statusCategory =
    statusLabel ??
    detail?.workflow?.jiraSnapshot?.statusCategory ??
    (detail ? 'In Progress' : 'To Do');
  const isPaused = detail?.run.status === 'paused';
  const isCancelled = detail?.run.status === 'cancelled';
  const showStart = !detail && canStart;
  const active = detail && !isCancelled && detail.run.status !== 'done';

  return (
    <div className="space-y-3">
      {/* Top toolbar — matches reference: back + key + badge | actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            to={custom ? `/workspaces/${projectId}?tab=custom` : `/workspaces/${projectId}`}
            className={`inline-flex items-center gap-1.5 text-sm ${taskMuted} transition-colors ${taskAccentHover}`}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to tasks
          </Link>
          {key && (
            <span className={`font-mono text-sm font-bold ${taskAccent}`}>{key}</span>
          )}
          {custom && !key && customKey && (
            <span className={`font-mono text-sm font-bold ${taskAccent}`}>{customKey}</span>
          )}
          {custom && !key && !customKey && (
            <span className={`text-sm font-bold ${taskAccent}`}>Custom Task</span>
          )}
          <StatusBadge
            label={isPaused ? 'Paused' : isCancelled ? 'Cancelled' : statusCategory}
            variant={
              isCancelled
                ? 'offline'
                : isPaused
                  ? 'busy'
                  : statusCategory === 'Done'
                    ? 'online'
                    : statusCategory === 'To Do'
                      ? 'default'
                      : 'busy'
            }
            dot
          />
        </div>

        <div className="flex items-center gap-2">
          {(showStart || active) && (
            <button
              type="button"
              className={taskBtnGhost}
              disabled={!active || pausePending}
              onClick={onPause}
            >
              {isPaused ? (
                <>
                  <Play className="h-4 w-4" />
                  Resume
                </>
              ) : (
                <>
                  <Pause className="h-4 w-4" />
                  Pause Task
                </>
              )}
            </button>
          )}
          {showStart && (
            <button
              type="button"
              className={taskBtnPrimary}
              disabled={startPending}
              onClick={onStart}
            >
              {startPending ? 'Starting…' : 'Start Task'}
            </button>
          )}
          {active && (
            <button
              type="button"
              className={taskBtnDanger}
              disabled={cancelPending}
              onClick={onCancel}
            >
              <XCircle className="h-4 w-4" />
              Cancel Task
            </button>
          )}
          <button
            type="button"
            className={taskIconBtn}
            aria-label="More actions"
          >
            <MoreVertical className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Title + Jira link */}
      {title && (
        <h1 className={taskHeading}>{title}</h1>
      )}
      {jiraUrl && (
        <a
          href={jiraUrl}
          target="_blank"
          rel="noreferrer"
          className={`inline-flex items-center gap-1 text-sm ${taskAccent} hover:underline`}
        >
          Open in Jira <ExternalLink className="h-3.5 w-3.5" />
        </a>
      )}

      {/* Secondary links (replaces removed sidebar) */}
      <div className={`flex flex-wrap items-center gap-4 text-xs ${taskMuted}`}>
        {onStartCustom && (
          <button
            type="button"
            className={taskAccentHover}
            onClick={onStartCustom}
          >
            + New custom task
          </button>
        )}
        {onShowHistory && (
          <button type="button" className={taskAccentHover} onClick={onShowHistory}>
            View history
          </button>
        )}
      </div>
    </div>
  );
}
