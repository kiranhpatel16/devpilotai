import type { JiraAttachment } from '@cpwork/shared';
import { Download, FileText, Image } from 'lucide-react';
import { taskAccent, taskBody, taskMuted, taskPanel, taskPanelHeader, taskSurface, taskTitle } from './taskStyles';

interface AttachmentsPanelProps {
  attachments: JiraAttachment[];
}

export function AttachmentsPanel({ attachments }: AttachmentsPanelProps) {
  if (attachments.length === 0) return null;

  return (
    <div className={`${taskPanel} shrink-0`}>
      <header className={taskPanelHeader}>
        <h3 className={taskTitle}>Attachments ({attachments.length})</h3>
      </header>
      <ul className="grid gap-2 p-4 sm:grid-cols-2">
        {attachments.map((a) => (
          <li key={a.id}>
            <a
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className={`flex items-center gap-3 ${taskSurface} p-2.5 transition-colors hover:border-brand-500/40`}
            >
              {a.isImage ? (
                <Image className={`h-4 w-4 shrink-0 ${taskAccent}`} />
              ) : (
                <FileText className="h-4 w-4 shrink-0 text-slate-400" />
              )}
              <div className="min-w-0 flex-1">
                <p className={`truncate text-sm ${taskBody}`}>{a.filename}</p>
                {a.size != null && (
                  <p className={`text-[10px] ${taskMuted}`}>{formatSize(a.size)}</p>
                )}
              </div>
              <Download className="h-3.5 w-3.5 shrink-0 text-slate-500" />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
