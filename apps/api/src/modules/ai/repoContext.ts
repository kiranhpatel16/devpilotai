import fs from 'node:fs';
import path from 'node:path';

export interface RepoContext {
  overview: string;
  excerpts: { path: string; content: string }[];
}

const SCAN_ROOTS = ['app/code', 'app/design'];
const SKIP_DIRS = new Set([
  'vendor',
  'generated',
  'var',
  'pub',
  'node_modules',
  '.git',
  'i18n',
  'web',
]);
const CODE_EXT = new Set(['.php', '.phtml', '.xml', '.html', '.js']);
const MAX_TRAVERSE = 40_000;
const MAX_EXCERPTS = 12;
const EXCERPT_CHARS = 3_500;

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'add', 'fix', 'page', 'home', 'update', 'change',
  'create', 'new', 'issue', 'show', 'this', 'that', 'from', 'into', 'when',
  'please', 'work', 'task', 'magento', 'should', 'will', 'need', 'want', 'make',
]);

/** Extract meaningful keywords from the task text + branch. */
export function extractKeywords(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
  return Array.from(new Set(tokens)).slice(0, 20);
}

function listDirs(full: string): string[] {
  try {
    return fs
      .readdirSync(full, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/** List frontend themes (app/design/frontend/<Vendor>/<theme>) in a project. */
export function listFrontendThemes(cwd: string): string[] {
  const themesRoot = path.join(cwd, 'app/design/frontend');
  const themes: string[] = [];
  for (const vendor of listDirs(themesRoot)) {
    for (const theme of listDirs(path.join(themesRoot, vendor))) {
      themes.push(`${vendor}/${theme}`);
    }
  }
  return themes;
}

/** Build a short map of themes + modules for orientation. */
function buildOverview(cwd: string, activeTheme?: string | null): string {
  const lines: string[] = [];

  const themes = listFrontendThemes(cwd);
  if (themes.length) {
    lines.push(`Frontend themes (app/design/frontend): ${themes.join(', ')}`);
  }
  if (activeTheme) {
    lines.push(
      `ACTIVE frontend theme: ${activeTheme} — make ALL theme/template/layout edits under app/design/frontend/${activeTheme}/ and do not touch other themes.`,
    );
  }

  // Modules (app/code/<Vendor>/<Module>)
  const codeRoot = path.join(cwd, 'app/code');
  const modules: string[] = [];
  for (const vendor of listDirs(codeRoot)) {
    for (const mod of listDirs(path.join(codeRoot, vendor))) {
      modules.push(`${vendor}_${mod}`);
    }
  }
  if (modules.length) {
    lines.push(
      `Custom modules (app/code, ${modules.length}): ${modules.slice(0, 60).join(', ')}${
        modules.length > 60 ? ', …' : ''
      }`,
    );
  }

  if (!lines.length) {
    lines.push('No app/code or app/design directories found at the project root.');
  }
  return lines.join('\n');
}

/** Walk scan roots collecting candidate code files (bounded). */
function collectFiles(cwd: string): string[] {
  const out: string[] = [];
  let traversed = 0;

  function walk(dir: string) {
    if (traversed > MAX_TRAVERSE) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      traversed++;
      if (traversed > MAX_TRAVERSE) return;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(path.join(dir, e.name));
      } else if (CODE_EXT.has(path.extname(e.name))) {
        out.push(path.join(dir, e.name));
      }
    }
  }

  for (const root of SCAN_ROOTS) {
    const full = path.join(cwd, root);
    if (fs.existsSync(full)) walk(full);
  }
  return out;
}

/** Score a file by how many distinct keywords appear in its relative path. */
function scoreByPath(relPath: string, keywords: string[], activeTheme?: string | null): number {
  const lower = relPath.toLowerCase();
  let score = 0;
  for (const kw of keywords) if (lower.includes(kw)) score++;
  // Layout XML and templates are high-value wiring files.
  if (/\/layout\/.*\.xml$/.test(lower)) score += 0.5;
  if (lower.endsWith('.phtml')) score += 0.25;
  // Strongly prefer the active theme; de-prioritize other themes' files.
  if (activeTheme) {
    const themeSeg = `app/design/frontend/${activeTheme.toLowerCase()}/`;
    if (lower.startsWith(themeSeg)) score += 2;
    else if (lower.startsWith('app/design/frontend/')) score -= 1;
  }
  return score;
}

/**
 * Gather repository grounding for the AI: a structural overview plus excerpts
 * of the files most relevant to the task keywords. Bounded for speed/tokens.
 */
export function buildRepoContext(
  cwd: string,
  taskText: string,
  activeTheme?: string | null,
): RepoContext {
  const overview = buildOverview(cwd, activeTheme);
  const keywords = extractKeywords(taskText);

  if (keywords.length === 0) {
    return { overview, excerpts: [] };
  }

  const files = collectFiles(cwd);
  const scored = files
    .map((full) => {
      const rel = path.relative(cwd, full);
      return { full, rel, score: scoreByPath(rel, keywords, activeTheme) };
    })
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_EXCERPTS);

  const excerpts: { path: string; content: string }[] = [];
  for (const f of scored) {
    try {
      const content = fs.readFileSync(f.full, 'utf8').slice(0, EXCERPT_CHARS);
      excerpts.push({ path: f.rel, content });
    } catch {
      // unreadable file — skip
    }
  }

  return { overview, excerpts };
}
