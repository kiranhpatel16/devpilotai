type StatusVariant = 'online' | 'busy' | 'offline' | 'default';

const VARIANTS: Record<StatusVariant, string> = {
  online: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400',
  busy: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400',
  offline: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400',
  default: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};

interface StatusBadgeProps {
  label: string;
  variant?: StatusVariant;
  dot?: boolean;
}

export function StatusBadge({ label, variant = 'default', dot }: StatusBadgeProps) {
  return (
    <span className={`badge gap-1.5 ${VARIANTS[variant]}`}>
      {dot && (
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            variant === 'online'
              ? 'bg-emerald-500'
              : variant === 'busy'
                ? 'bg-amber-500'
                : 'bg-slate-400'
          }`}
        />
      )}
      {label}
    </span>
  );
}
