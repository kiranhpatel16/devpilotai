/** Magento local deploy intensity — auto-detected from changed files unless project overrides. */
export type DeployProfile = 'light' | 'standard' | 'full';

export type DeployProfileMode = DeployProfile | 'auto';

export const DEPLOY_STEP_LABELS: Record<string, string> = {
  docker_target: 'Docker target',
  composer_install: 'Composer install',
  clear_generated: 'Clear static/cache/generated',
  setup_upgrade: 'setup:upgrade',
  di_compile: 'setup:di:compile',
  static_deploy: 'setup:static-content:deploy',
  cache_clean: 'cache:clean',
  cache_flush: 'cache:flush',
  chmod_permissions: 'chmod permissions',
};

export const DEPLOY_PROFILE_LABELS: Record<DeployProfile, string> = {
  light: 'Light — cache flush only',
  standard: 'Standard — DI compile + cache',
  full: 'Full — composer, upgrade, compile, static',
};

function norm(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

function isLightPath(path: string): boolean {
  const p = norm(path);
  if (p.endsWith('.phtml') || p.endsWith('.html')) return true;
  if (p.endsWith('.css') || p.endsWith('.js') || p.endsWith('.less')) return true;
  if (p.includes('/layout/') && p.endsWith('.xml')) return true;
  if (p.includes('/templates/') && p.endsWith('.xml')) return true;
  return false;
}

function needsFullDeploy(paths: string[]): boolean {
  return paths.some((raw) => {
    const p = norm(raw);
    if (p.endsWith('composer.json') || p.endsWith('composer.lock')) return true;
    if (p.endsWith('module.xml') || p.includes('/etc/module.xml')) return true;
    if (p.includes('/setup/')) return true;
    if (p.endsWith('.php') && (p.includes('/registration.php') || p.endsWith('/registration.php')))
      return true;
    return false;
  });
}

function needsStandardDeploy(paths: string[]): boolean {
  return paths.some((raw) => {
    const p = norm(raw);
    if (p.endsWith('.php')) return true;
    if (p.endsWith('di.xml') || p.includes('/etc/di.xml')) return true;
    if (p.includes('/etc/') && p.endsWith('.xml')) return true;
    if (p.includes('/view/frontend/') && p.endsWith('.xml') && !p.includes('/layout/')) return true;
    return false;
  });
}

function needsStaticDeploy(paths: string[]): boolean {
  return paths.some((raw) => {
    const p = norm(raw);
    return (
      p.endsWith('.less') ||
      p.endsWith('.css') ||
      p.includes('/web/css/') ||
      p.includes('/web/js/')
    );
  });
}

/** Classify changed paths into light / standard / full (no project override). */
export function classifyDeployProfile(changedPaths: string[]): DeployProfile {
  const paths = changedPaths.filter(Boolean);
  if (paths.length === 0) return 'light';
  if (needsFullDeploy(paths)) return 'full';
  if (needsStandardDeploy(paths)) return 'standard';
  if (paths.every(isLightPath)) return 'light';
  return 'standard';
}

export function resolveDeployProfile(
  changedPaths: string[],
  projectMode: DeployProfileMode = 'auto',
): DeployProfile {
  if (projectMode !== 'auto') return projectMode;
  return classifyDeployProfile(changedPaths);
}

export function shouldRunComposerInstall(
  profile: DeployProfile,
  changedPaths: string[],
  skipComposerProject = false,
): boolean {
  if (skipComposerProject) return false;
  if (profile === 'light') return false;
  return changedPaths.some((p) => {
    const n = norm(p);
    return n.endsWith('composer.json') || n.endsWith('composer.lock');
  });
}

export function shouldRunSetupUpgrade(profile: DeployProfile, changedPaths: string[]): boolean {
  if (profile !== 'full') return false;
  return needsFullDeploy(changedPaths);
}

export function shouldRunDiCompile(profile: DeployProfile): boolean {
  return profile === 'standard' || profile === 'full';
}

export function shouldRunStaticDeploy(profile: DeployProfile, changedPaths: string[]): boolean {
  if (profile === 'full') return true;
  return needsStaticDeploy(changedPaths);
}

export function deployProfileReason(profile: DeployProfile, changedPaths: string[]): string {
  const names = changedPaths.map((p) => p.split('/').pop() || p).slice(0, 4);
  const suffix = changedPaths.length > 4 ? ` +${changedPaths.length - 4} more` : '';
  const files = names.length ? `${names.join(', ')}${suffix}` : 'no file list';
  switch (profile) {
    case 'light':
      return `Template/layout-only changes (${files}) — cache flush is enough.`;
    case 'standard':
      return `PHP or config XML changed (${files}) — DI compile required.`;
    case 'full':
      return `Composer or module setup changed (${files}) — full Magento deploy.`;
  }
}
