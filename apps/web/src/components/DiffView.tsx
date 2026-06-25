import type { FileDiff } from '@cpwork/shared';

function lineClass(line: string): string {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'bg-green-950/40 text-green-300';
  if (line.startsWith('-') && !line.startsWith('---')) return 'bg-red-950/40 text-red-300';
  if (line.startsWith('@@')) return 'text-cyan-400';
  return 'text-slate-400';
}

export function DiffView({ diff }: { diff: FileDiff }) {
  const lines = (diff.patch ?? '').split('\n');
  return (
    <pre className="overflow-x-auto rounded-md bg-slate-900 p-3 text-[11px] leading-relaxed">
      {lines.map((line, i) => (
        <div key={i} className={lineClass(line)}>
          {line || ' '}
        </div>
      ))}
    </pre>
  );
}
