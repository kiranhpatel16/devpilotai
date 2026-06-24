interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="card flex flex-col items-center justify-center p-8 text-center">
      <p className="font-medium text-slate-700 dark:text-slate-200">{title}</p>
      {description && (
        <p className="mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
