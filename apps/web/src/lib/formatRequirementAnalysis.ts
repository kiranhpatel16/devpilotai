/** Format requirement analysis fields for readable UI display. */

export function normalizeAnalysisText(value: string | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  if (!raw.startsWith('{')) return raw;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed.objective === 'string' && parsed.objective.trim()) {
      return parsed.objective.trim();
    }
    if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
      return parsed.summary.trim();
    }
  } catch {
    /* keep raw */
  }
  return raw;
}

export function buildLikelyFilesTree(paths: string[] | undefined): string {
  const normalized = [
    ...new Set(
      (paths ?? [])
        .map((p) => p.replace(/\\/g, '/').trim())
        .filter(Boolean),
    ),
  ].sort();
  if (!normalized.length) return '';

  const split = normalized.map((p) => p.split('/'));
  let commonDepth = 0;
  while (
    split.length > 0 &&
    split.every(
      (parts) =>
        parts.length > commonDepth && parts[commonDepth] === split[0][commonDepth],
    )
  ) {
    commonDepth++;
  }
  const root = split[0].slice(0, commonDepth).join('/');
  const rootLabel = root ? `${root}/` : '';
  const relPaths = normalized.map((p) =>
    root && p.startsWith(`${root}/`) ? p.slice(root.length + 1) : p,
  );

  const tree = new Map<string, Set<string>>();
  for (const rel of relPaths) {
    const segments = rel.split('/').filter(Boolean);
    if (!segments.length) continue;
    const file = segments[segments.length - 1];
    const dir = segments.length > 1 ? segments.slice(0, -1).join('/') : '.';
    if (!tree.has(dir)) tree.set(dir, new Set());
    tree.get(dir)!.add(file);
  }

  const lines: string[] = [];
  if (rootLabel) lines.push(rootLabel);
  const dirs = [...tree.keys()].sort((a, b) => a.localeCompare(b));
  for (const dir of dirs) {
    if (dir !== '.') {
      lines.push(`${dir}/`);
    }
    const files = [...tree.get(dir)!].sort();
    for (const file of files) {
      lines.push(dir === '.' ? file : `  ├── ${file}`);
    }
  }
  return lines.join('\n');
}

export function riskLevelClass(level: string | undefined): string {
  const key = (level ?? '').trim().toLowerCase();
  if (key === 'high' || key === 'critical') return 'bg-red-500/20 text-red-200';
  if (key === 'medium') return 'bg-amber-500/20 text-amber-200';
  if (key === 'low') return 'bg-emerald-500/20 text-emerald-200';
  return 'bg-slate-500/20 text-slate-300';
}
