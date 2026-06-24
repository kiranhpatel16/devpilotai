interface PipelineFunnelProps {
  stages: { label: string; count: number; color: string }[];
}

export function PipelineFunnel({ stages }: PipelineFunnelProps) {
  const max = Math.max(...stages.map((s) => s.count), 1);

  return (
    <div className="card p-4">
      <h3 className="mb-4 text-sm font-medium text-slate-900 dark:text-slate-100">
        Pipeline Overview
      </h3>
      <div className="flex flex-wrap items-end justify-between gap-3">
        {stages.map((stage) => (
          <div key={stage.label} className="flex min-w-[72px] flex-1 flex-col items-center gap-2">
            <div
              className="flex w-full items-end justify-center rounded-t-xl transition-all"
              style={{
                height: `${Math.max(24, (stage.count / max) * 80)}px`,
                background: `${stage.color}33`,
                borderBottom: `3px solid ${stage.color}`,
              }}
            >
              <span className="pb-1 text-lg font-bold text-slate-900 dark:text-slate-100">
                {stage.count}
              </span>
            </div>
            <span className="text-center text-xs text-slate-500">{stage.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
