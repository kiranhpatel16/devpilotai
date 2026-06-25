import { useState } from 'react';
import type { JiraIssueDetail } from '@cpwork/shared';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { AcceptanceCriteriaPanel } from './AcceptanceCriteriaPanel';
import { AttachmentsPanel } from './AttachmentsPanel';
import { TaskDetailsPanel } from './TaskDetailsPanel';
import { taskDivider, taskMuted, taskSurface, taskTitle } from './taskStyles';

interface TaskContextRailProps {
  issue: JiraIssueDetail | null;
  customTitle?: string;
  defaultCollapsed?: boolean;
  showAcceptance?: boolean;
}

export function TaskContextRail({
  issue,
  customTitle,
  defaultCollapsed = false,
  showAcceptance = true,
}: TaskContextRailProps) {
  const [open, setOpen] = useState(!defaultCollapsed);
  const attachments = issue?.attachments ?? [];
  const hasContent = issue?.description || customTitle || attachments.length > 0;

  if (!hasContent && !showAcceptance) return null;

  return (
    <div className={taskSurface}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left"
      >
        <span className={`text-sm font-medium ${taskTitle}`}>Task context</span>
        <span className={`flex items-center gap-1 text-xs ${taskMuted}`}>
          {open ? 'Collapse' : 'Expand'}
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
      </button>
      {open && (
        <div className={`space-y-3 border-t ${taskDivider} p-3`}>
          <TaskDetailsPanel
            issue={issue}
            customTitle={customTitle}
            createdBy={issue?.assignee}
            createdAt={issue?.updated}
            expanded
          />
          <AttachmentsPanel attachments={attachments} />
          {showAcceptance && <AcceptanceCriteriaPanel />}
        </div>
      )}
    </div>
  );
}
