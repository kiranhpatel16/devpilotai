import fs from 'node:fs';
import path from 'node:path';
import type {
  EnvironmentHealth,
  EnvironmentHealthCheck,
  Project,
  UserProjectEnvironment,
} from '@cpwork/shared';
import { HttpError } from '../../lib/httpError.js';
import { projectsRepo } from '../../db/repositories/projects.js';
import { environmentsRepo } from '../../db/repositories/environments.js';

export interface ResolvedEnvironment {
  project: Project;
  env: UserProjectEnvironment;
  cwd: string;
  frontendUrl: string | null;
  backendUrl: string | null;
}

/**
 * Resolve the effective environment for a user+project.
 * The path always comes from the user's own environment row — never the client.
 */
export function resolveEnvironment(
  userId: string,
  projectId: string,
): ResolvedEnvironment {
  const project = projectsRepo.findById(projectId);
  if (!project) throw HttpError.notFound('Project not found');

  const env = environmentsRepo.find(userId, projectId);
  if (!env || !env.projectRoot) {
    throw new HttpError(
      409,
      'Configure your local environment for this project first',
      'needs_local_setup',
      { projectId, suggestedDefaults: project.defaults },
    );
  }

  if (!fs.existsSync(env.projectRoot)) {
    throw new HttpError(
      409,
      `Project path does not exist on this machine: ${env.projectRoot}`,
      'path_not_found',
      { projectId, path: env.projectRoot },
    );
  }

  return {
    project,
    env,
    cwd: env.projectRoot,
    frontendUrl: env.frontendUrl ?? project.defaults.frontendUrl,
    backendUrl: env.backendUrl ?? project.defaults.backendUrl,
  };
}

/** Run filesystem-level checks on a candidate project root. */
export function checkEnvironmentPath(
  projectRoot: string,
  phpBin?: string | null,
): EnvironmentHealth {
  const checks: EnvironmentHealthCheck[] = [];

  const pathExists = !!projectRoot && fs.existsSync(projectRoot);
  checks.push({
    key: 'path_exists',
    label: 'Project path exists',
    ok: pathExists,
    detail: pathExists ? projectRoot : 'Directory not found',
  });

  let isDir = false;
  if (pathExists) {
    try {
      isDir = fs.statSync(projectRoot).isDirectory();
    } catch {
      isDir = false;
    }
  }
  checks.push({
    key: 'is_directory',
    label: 'Path is a directory',
    ok: isDir,
  });

  const magentoBin = pathExists ? path.join(projectRoot, 'bin', 'magento') : '';
  const hasMagento = !!magentoBin && fs.existsSync(magentoBin);
  checks.push({
    key: 'magento_bin',
    label: 'Magento detected (bin/magento)',
    ok: hasMagento,
    detail: hasMagento ? 'bin/magento found' : 'bin/magento not found',
  });

  const gitDir = pathExists ? path.join(projectRoot, '.git') : '';
  const hasGit = !!gitDir && fs.existsSync(gitDir);
  checks.push({
    key: 'git_repo',
    label: 'Git repository present',
    ok: hasGit,
  });

  const composerJson = pathExists ? path.join(projectRoot, 'composer.json') : '';
  const hasComposer = !!composerJson && fs.existsSync(composerJson);
  checks.push({
    key: 'composer',
    label: 'composer.json present',
    ok: hasComposer,
  });

  const phpunit = pathExists
    ? path.join(projectRoot, 'vendor', 'bin', 'phpunit')
    : '';
  const hasPhpunit = !!phpunit && fs.existsSync(phpunit);
  checks.push({
    key: 'phpunit',
    label: 'PHPUnit available (vendor/bin/phpunit)',
    ok: hasPhpunit,
    detail: hasPhpunit ? undefined : 'Optional, needed for the test pipeline',
  });

  // Required checks gate "ok"; phpunit is advisory only.
  const requiredKeys = ['path_exists', 'is_directory', 'magento_bin', 'git_repo'];
  const ok = checks
    .filter((c) => requiredKeys.includes(c.key))
    .every((c) => c.ok);

  void phpBin; // reserved for future php -v execution check

  return {
    checkedAt: new Date().toISOString(),
    ok,
    checks,
  };
}
