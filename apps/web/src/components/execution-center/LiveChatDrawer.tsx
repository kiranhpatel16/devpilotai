import { useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { LiveChatPanel } from './LiveChatPanel';
import { taskBtnPrimary } from './taskStyles';

interface LiveChatDrawerProps {
  projectId: string;
}

export function LiveChatDrawer({ projectId }: LiveChatDrawerProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${taskBtnPrimary} fixed bottom-6 right-6 z-40 h-12 w-12 rounded-full p-0 shadow-lg shadow-brand-900/40`}
        aria-label="Ask DevPilot"
      >
        <MessageCircle className="h-5 w-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <button
            type="button"
            className="absolute inset-0 bg-black/50"
            aria-label="Close chat"
            onClick={() => setOpen(false)}
          />
          <div className="relative flex h-full w-full max-w-md flex-col border-l border-slate-700/80 bg-[#12121f] shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700/60 px-4 py-3">
              <h2 className="text-sm font-semibold text-white">Ask DevPilot</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden p-3">
              <LiveChatPanel projectId={projectId} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
