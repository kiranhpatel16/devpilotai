import { Loader2 } from 'lucide-react';

interface TabBusyOverlayProps {
  show: boolean;
  label: string;
  detail?: string;
}

/** Tab-scoped overlay matching the global workflow busy modal style. */
export function TabBusyOverlay({ show, label, detail }: TabBusyOverlayProps) {
  if (!show) return null;

  return (
    <div
      className="absolute inset-0 z-20 flex items-start justify-center rounded-lg bg-slate-950/55 pt-8 backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
    >
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-slate-700/80 bg-slate-900/95 px-8 py-6 shadow-2xl">
        <Loader2 className="h-10 w-10 animate-spin text-brand-400" />
        <p className="text-sm font-medium text-slate-100">{label}</p>
        <p className="text-xs text-slate-400">Please wait — stay on this tab to watch progress.</p>
        {detail && (
          <div className="w-full border-t border-slate-700/60 pt-3 text-center">
            <p className="text-xs leading-relaxed text-slate-300">{detail}</p>
          </div>
        )}
      </div>
    </div>
  );
}
