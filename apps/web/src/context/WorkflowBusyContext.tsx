import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Loader2 } from 'lucide-react';

interface WorkflowBusyContextValue {
  setBusy: (id: string, busy: boolean, label?: string) => void;
}

const WorkflowBusyContext = createContext<WorkflowBusyContextValue | null>(null);

export function WorkflowBusyProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Map<string, string>>(new Map());

  const setBusy = useCallback((id: string, busy: boolean, label = 'Working…') => {
    setEntries((prev) => {
      const next = new Map(prev);
      if (busy) next.set(id, label);
      else next.delete(id);
      return next;
    });
  }, []);

  const activeLabel = useMemo(() => {
    const labels = [...entries.values()];
    return labels[labels.length - 1] ?? 'Working…';
  }, [entries]);

  const isBusy = entries.size > 0;

  return (
    <WorkflowBusyContext.Provider value={{ setBusy }}>
      {children}
      {isBusy && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/55 backdrop-blur-[2px]"
          role="status"
          aria-live="polite"
          aria-busy="true"
          aria-label={activeLabel}
        >
          <div className="flex flex-col items-center gap-3 rounded-xl border border-slate-700/80 bg-slate-900/95 px-8 py-6 shadow-2xl">
            <Loader2 className="h-10 w-10 animate-spin text-brand-400" />
            <p className="text-sm font-medium text-slate-100">{activeLabel}</p>
            <p className="text-xs text-slate-400">Please wait — do not navigate away.</p>
          </div>
        </div>
      )}
    </WorkflowBusyContext.Provider>
  );
}

/** Register a blocking busy state while `busy` is true (e.g. mutation pending). */
export function useWorkflowBusy(id: string, busy: boolean, label?: string) {
  const ctx = useContext(WorkflowBusyContext);
  const setBusy = ctx?.setBusy;

  useEffect(() => {
    if (!setBusy) return;
    setBusy(id, busy, label);
    return () => setBusy(id, false);
  }, [id, busy, label, setBusy]);
}
