import { execa } from 'execa';
import { HttpError } from '../../lib/httpError.js';

async function ghAvailable(): Promise<boolean> {
  try {
    const r = await execa('gh', ['--version'], { reject: false });
    return r.exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Create a pull request to the staging branch using the GitHub CLI.
 * Throws a clear, actionable error when gh is unavailable or not authed.
 */
export async function createPullRequest(
  cwd: string,
  base: string,
  head: string,
  title: string,
  body: string,
): Promise<string> {
  if (!(await ghAvailable())) {
    throw new HttpError(
      503,
      'GitHub CLI (gh) is not installed on this server. Install gh and run `gh auth login`, or open the PR manually.',
      'gh_missing',
      { base, head, title },
    );
  }

  const result = await execa(
    'gh',
    ['pr', 'create', '--base', base, '--head', head, '--title', title, '--body', body],
    { cwd, reject: false, all: true },
  );

  if (result.exitCode !== 0) {
    throw new HttpError(502, 'gh pr create failed', 'gh_pr_failed', {
      output: (result.all ?? '').slice(-1000),
    });
  }

  // gh prints the PR URL on success.
  const url = (result.stdout || '').trim().split('\n').find((l) => l.startsWith('http'));
  return url ?? (result.stdout || '').trim();
}
