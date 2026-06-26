/** Shared Tailwind class strings for the task execution center (light + dark). */

export const taskCard =
  'rounded-xl border border-slate-200 bg-white shadow-card dark:border-neutral-800/80 dark:bg-[#0a0a0a] dark:shadow-lg dark:shadow-black/20';

export const taskPanel =
  'rounded-lg border border-slate-200 bg-white dark:border-neutral-800/60 dark:bg-[#111111]';

export const taskPanelHeader =
  'border-b border-slate-200 px-4 py-3 dark:border-neutral-800/60';

export const taskTitle = 'text-sm font-medium text-slate-900 dark:text-white';

export const taskMuted = 'text-slate-500 dark:text-slate-400';

export const taskBody = 'text-slate-700 dark:text-slate-300';

export const taskHeading = 'text-xl font-semibold leading-snug text-slate-900 dark:text-white';

export const taskAccent = 'text-brand-600 dark:text-brand-400';

export const taskAccentHover = 'hover:text-brand-600 dark:hover:text-brand-400';

export const taskStrong = 'text-slate-900 dark:text-slate-300';

export const taskSurface =
  'rounded-lg border border-slate-200 bg-slate-50 dark:border-neutral-800/60 dark:bg-[#0a0a0a]';

export const taskCodeSurface = 'bg-slate-100 dark:bg-[#050505]';

export const taskStickyFooter =
  'sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white/95 px-1 py-3 backdrop-blur-sm dark:border-neutral-800/60 dark:bg-[#0a0a0a]/95';

export const taskDivider = 'border-slate-200 dark:border-neutral-800/60';

export const taskIconBtn =
  'rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-neutral-900 dark:hover:text-slate-300';

export const taskInput =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-neutral-700 dark:bg-[#0a0a0a] dark:text-slate-100 dark:placeholder:text-slate-500';

export const taskBtnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-500 disabled:opacity-50';

export const taskBtnGhost =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-transparent px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-100 disabled:opacity-50 dark:border-neutral-700 dark:text-slate-300 dark:hover:border-neutral-600 dark:hover:bg-neutral-900';

export const taskBtnSecondary =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 dark:border-neutral-700 dark:bg-neutral-900 dark:text-slate-200 dark:hover:bg-neutral-800';

export const taskBtnDanger =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-red-300 bg-transparent px-4 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:opacity-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10';

/** Warning / risk copy — readable on light and dark surfaces. */
export const taskWarningText = 'text-amber-800 dark:text-amber-300';

export const taskRiskItem =
  'rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs leading-relaxed text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200';

/** File list row in Review / Files Changed panels. */
export function fileListItemClass(selected: boolean): string {
  const base =
    'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors';
  if (selected) {
    return `${base} bg-brand-600 text-white shadow-sm ring-1 ring-brand-500/50 dark:bg-brand-600 dark:ring-brand-400/40`;
  }
  return `${base} text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-neutral-800/90`;
}

export function fileActionBadgeClass(action: string, selected = false): string {
  const a = action.toLowerCase();
  const base = 'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold leading-none';
  if (selected) {
    if (a === 'create') return `${base} bg-emerald-300/30 text-emerald-50`;
    if (a === 'delete') return `${base} bg-red-300/30 text-red-50`;
    return `${base} bg-white/25 text-white`;
  }
  if (a === 'create') {
    return `${base} bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300`;
  }
  if (a === 'delete') {
    return `${base} bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400`;
  }
  return `${base} bg-brand-100 text-brand-800 dark:bg-brand-600/20 dark:text-brand-300`;
}

export function filePathTextClass(selected: boolean): string {
  return [
    'min-w-0 flex-1 break-all font-mono text-[11px] leading-snug',
    selected ? 'text-white' : 'text-slate-800 dark:text-slate-200',
  ].join(' ');
}
