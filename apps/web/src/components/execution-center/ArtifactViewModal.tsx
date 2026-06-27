import { useEffect } from 'react';
import { X } from 'lucide-react';
import { taskBtnGhost, taskPanel, taskTitle } from './taskStyles';

interface ArtifactViewModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

export function ArtifactViewModal({ open, title, onClose, children }: ArtifactViewModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="artifact-modal-title"
      onClick={onClose}
    >
      <div
        className={`${taskPanel} flex max-h-[85vh] w-full max-w-3xl flex-col shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-neutral-800">
          <h2 id="artifact-modal-title" className={taskTitle}>
            {title}
          </h2>
          <button
            type="button"
            className={taskBtnGhost}
            aria-label="Close"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">{children}</div>
      </div>
    </div>
  );
}
