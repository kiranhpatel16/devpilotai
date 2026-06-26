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

interface BusyEntry {
  label: string;
  detail?: string;
}

interface WorkflowBusyContextValue {
  setBusy: (id: string, busy: boolean, label?: string, detail?: string) => void;
}

const WorkflowBusyContext = createContext<WorkflowBusyContextValue | null>(null);

export function WorkflowBusyProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Map<string, BusyEntry>>(new Map());

  const setBusy = useCallback(
    (id: string, busy: boolean, label = 'Working…', detail?: string) => {
      setEntries((prev) => {
        const next = new Map(prev);
        if (busy) next.set(id, { label, detail });
        else next.delete(id);
        return next;
      });
    },
    [],
  );

  const active = useMemo(() => {
    const values = [...entries.values()];
    return values[values.length - 1] ?? { label: 'Working…' };
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
          aria-label={active.label}
        >
          <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-slate-700/80 bg-slate-900/95 px-8 py-6 shadow-2xl">
            <Loader2 className="h-10 w-10 animate-spin text-brand-400" />
            <p className="text-sm font-medium text-slate-100">{active.label}</p>
            <p className="text-xs text-slate-400">Please wait — do not navigate away.</p>
            {active.detail && (
              <div className="w-full border-t border-slate-700/60 pt-3 text-center">
                <p className="text-xs leading-relaxed text-slate-300">{active.detail}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </WorkflowBusyContext.Provider>
  );
}

/** Register a blocking busy state while `busy` is true (e.g. mutation pending). */
export function useWorkflowBusy(
  id: string,
  busy: boolean,
  label?: string,
  detail?: string,
) {
  const ctx = useContext(WorkflowBusyContext);
  const setBusy = ctx?.setBusy;

  useEffect(() => {
    if (!setBusy) return;
    setBusy(id, busy, label, detail);
    return () => setBusy(id, false);
  }, [id, busy, label, detail, setBusy]);
}
