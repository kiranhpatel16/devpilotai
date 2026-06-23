import fs from 'node:fs';
import path from 'node:path';
import { simpleGit, type SimpleGit } from 'simple-git';
import { createTwoFilesPatch } from 'diff';
import type { FileDiff, GitInfo, ProposedFileChange } from '@cpwork/shared';
import { HttpError } from '../../lib/httpError.js';

function git(cwd: string): SimpleGit {
  return simpleGit({ baseDir: cwd, maxConcurrentProcesses: 1 });
}

/** Resolve a repo-relative path safely inside cwd (blocks traversal). */
function safeJoin(cwd: string, relPath: string): string {
  if (!relPath || path.isAbsolute(relPath)) {
    throw HttpError.badRequest(`Unsafe file path: ${relPath}`);
  }
  const root = path.resolve(cwd);
  const full = path.resolve(root, relPath);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw HttpError.badRequest(`Unsafe file path escapes project root: ${relPath}`);
  }
  return full;
}

function readIfExists(full: string): string {
  try {
    return fs.readFileSync(full, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Compute the resulting file content for a proposed change.
 * - create: returns the full provided content.
 * - delete: returns null.
 * - modify: applies targeted search/replace edits to the CURRENT file so the
 *   rest of the file is preserved. Falls back to full content if no edits given.
 * Returns an `error` (and leaves content null) when an edit cannot be located,
 * so callers can refuse to apply destructive/incorrect changes.
 */
export function resolveNewContent(
  cwd: string,
  change: ProposedFileChange,
): { content: string | null; error: string | null } {
  if (change.action === 'delete') return { content: null, error: null };

  if (change.action === 'create') {
    return { content: change.content ?? '', error: null };
  }

  // modify
  const full = safeJoin(cwd, change.path);
  const exists = fs.existsSync(full);

  if (change.edits && change.edits.length > 0) {
    if (!exists) {
      return { content: null, error: `Cannot apply edits: file does not exist (${change.path})` };
    }
    let content = readIfExists(full);
    for (let i = 0; i < change.edits.length; i++) {
      const { oldString, newString, replaceAll } = change.edits[i];
      if (oldString === '') {
        return { content: null, error: `Edit ${i + 1}: empty oldString is not allowed` };
      }
      if (!content.includes(oldString)) {
        return {
          content: null,
          error: `Edit ${i + 1}: could not find the text to replace in ${change.path}. The file was left unchanged.`,
        };
      }
      content = replaceAll
        ? content.split(oldString).join(newString)
        : content.replace(oldString, newString);
    }
    return { content, error: null };
  }

  // Fallback: full-content modify (legacy / when the model returns content).
  if (change.content != null) {
    return { content: change.content, error: null };
  }

  return { content: null, error: `No edits or content provided for ${change.path}` };
}

/** Create or checkout the feature branch from the production base branch. */
export async function createBranch(
  cwd: string,
  branch: string,
  baseBranch: string,
): Promise<{ branch: string; baseRef: string }> {
  const g = git(cwd);
  try {
    await g.fetch();
  } catch {
    // Offline or no remote configured — proceed with local refs.
  }

  let baseRef = baseBranch;
  try {
    await g.revparse(['--verify', `origin/${baseBranch}`]);
    baseRef = `origin/${baseBranch}`;
  } catch {
    try {
      await g.revparse(['--verify', baseBranch]);
      baseRef = baseBranch;
    } catch {
      baseRef = 'HEAD';
    }
  }

  const local = await g.branchLocal();
  const branchExists = local.all.includes(branch);

  const status = await g.status();
  const isDirty = status.files.length > 0;
  let stashed = false;

  const autostash = async () => {
    if (!isDirty) return;
    await g.stash(['push', '-u', '-m', 'CPWork: autostash before branch checkout']);
    stashed = true;
  };

  try {
    if (branchExists) {
      if (status.current !== branch) {
        await autostash();
        await g.checkout(branch);
      }
    } else {
      await autostash();
      await g.checkoutBranch(branch, baseRef);
    }
  } catch (err) {
    if (stashed) {
      try {
        await g.stash(['pop']);
      } catch {
        // leave stash for manual recovery
      }
    }
    throw new HttpError(
      500,
      `Failed to create branch "${branch}" from ${baseRef}`,
      'git_branch_failed',
      { cause: err instanceof Error ? err.message : String(err), baseRef },
    );
  }
  return { branch, baseRef, stashed };
}

/** Compute unified diffs between the working tree and proposed changes. */
export function computeDiffs(cwd: string, files: ProposedFileChange[]): FileDiff[] {
  return files.map((f) => {
    const full = safeJoin(cwd, f.path);
    const current = f.action === 'create' ? '' : readIfExists(full);
    const resolved = resolveNewContent(cwd, f);

    if (resolved.error) {
      return {
        path: f.path,
        action: f.action,
        reason: f.reason,
        patch: '',
        added: 0,
        removed: 0,
        error: resolved.error,
      };
    }

    const proposed = resolved.content ?? '';
    const patch = createTwoFilesPatch(`a/${f.path}`, `b/${f.path}`, current, proposed, '', '');
    let added = 0;
    let removed = 0;
    for (const line of patch.split('\n')) {
      if (line.startsWith('+') && !line.startsWith('+++')) added++;
      else if (line.startsWith('-') && !line.startsWith('---')) removed++;
    }
    return { path: f.path, action: f.action, reason: f.reason, patch, added, removed, error: null };
  });
}

export interface FileBackup {
  path: string;
  existedBefore: boolean;
  previousContent: string | null;
}

/** Snapshot current file state BEFORE applying, so changes can be reverted. */
export function captureBackups(
  cwd: string,
  files: ProposedFileChange[],
  selectedPaths?: string[],
): FileBackup[] {
  const backups: FileBackup[] = [];
  for (const f of files) {
    if (selectedPaths && !selectedPaths.includes(f.path)) continue;
    const full = safeJoin(cwd, f.path);
    const existedBefore = fs.existsSync(full);
    backups.push({
      path: f.path,
      existedBefore,
      previousContent: existedBefore ? readIfExists(full) : null,
    });
  }
  return backups;
}

/** Restore files to their pre-apply state. Deletes files that were newly created. */
export function revertChanges(cwd: string, backups: FileBackup[]): string[] {
  const reverted: string[] = [];
  for (const b of backups) {
    const full = safeJoin(cwd, b.path);
    if (b.existedBefore) {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, b.previousContent ?? '', 'utf8');
    } else if (fs.existsSync(full)) {
      fs.rmSync(full);
    }
    reverted.push(b.path);
  }
  return reverted;
}

/**
 * Write proposed file changes to the working tree. Returns applied paths.
 * Resolves all selected changes first and aborts (writing nothing) if any
 * edit cannot be located — so a bad match never destroys file content.
 */
export function applyChanges(
  cwd: string,
  files: ProposedFileChange[],
  selectedPaths?: string[],
): string[] {
  const selected = files.filter((f) => !selectedPaths || selectedPaths.includes(f.path));

  // Pass 1: resolve everything; collect any errors before touching disk.
  const resolved = selected.map((f) => ({ change: f, ...resolveNewContent(cwd, f) }));
  const failures = resolved.filter((r) => r.error);
  if (failures.length > 0) {
    throw new HttpError(
      409,
      `Could not apply ${failures.length} change(s): ${failures
        .map((r) => `${r.change.path} — ${r.error}`)
        .join('; ')}`,
      'apply_edit_failed',
      { failures: failures.map((r) => ({ path: r.change.path, error: r.error })) },
    );
  }

  // Pass 2: write.
  const applied: string[] = [];
  for (const r of resolved) {
    const full = safeJoin(cwd, r.change.path);
    if (r.change.action === 'delete') {
      if (fs.existsSync(full)) fs.rmSync(full);
    } else {
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, r.content ?? '', 'utf8');
    }
    applied.push(r.change.path);
  }
  return applied;
}

export async function getStatus(cwd: string, baseBranch: string): Promise<GitInfo> {
  const g = git(cwd);
  const status = await g.status();
  let ahead = status.ahead;
  let behind = status.behind;
  // Best-effort ahead/behind vs base if tracking not set.
  return {
    branch: status.current ?? null,
    baseBranch,
    ahead,
    behind,
    staged: status.staged.length,
    changedFiles: status.files.map((f) => f.path),
    committed: false,
    pushed: false,
    commitMessage: null,
    prUrl: null,
  };
}

export async function commitAll(cwd: string, message: string): Promise<string> {
  const g = git(cwd);
  await g.add(['-A']);
  const result = await g.commit(message);
  return result.commit;
}

export async function pushBranch(
  cwd: string,
  branch: string,
  remote = 'origin',
): Promise<void> {
  const g = git(cwd);
  try {
    await g.push(['-u', remote, branch]);
  } catch (err) {
    throw new HttpError(500, `Failed to push branch "${branch}"`, 'git_push_failed', {
      cause: err instanceof Error ? err.message : String(err),
    });
  }
}
