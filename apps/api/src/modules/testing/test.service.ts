import fs from 'node:fs';
import path from 'node:path';
import { execa } from 'execa';
import type { TestReport, TestStep } from '@cpwork/shared';

const STEP_TIMEOUT_MS = 120_000;

async function run(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ ok: boolean; output: string }> {
  try {
    const result = await execa(cmd, args, {
      cwd,
      reject: false,
      timeout: STEP_TIMEOUT_MS,
      all: true,
    });
    return {
      ok: result.exitCode === 0,
      output: (result.all ?? '').slice(-4000),
    };
  } catch (err) {
    return { ok: false, output: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Run the Magento test pipeline against changed files.
 * php -l (lint) is required; PHPUnit runs if configured; di:compile is advisory.
 */
export async function runTests(
  cwd: string,
  changedPaths: string[],
  phpBin = 'php',
): Promise<TestReport> {
  const steps: TestStep[] = [];
  const phpFiles = changedPaths.filter((p) => p.endsWith('.php'));

  // T1 — PHP lint on changed files.
  if (phpFiles.length === 0) {
    steps.push({
      key: 'php_lint',
      label: 'PHP lint (php -l)',
      ok: true,
      skipped: true,
      output: 'No PHP files changed.',
    });
  } else {
    const lintOutputs: string[] = [];
    let lintOk = true;
    for (const rel of phpFiles) {
      const r = await run(phpBin, ['-l', path.join(cwd, rel)], cwd);
      if (!r.ok) lintOk = false;
      lintOutputs.push(`${rel}: ${r.ok ? 'OK' : 'FAIL'}\n${r.output}`);
    }
    steps.push({
      key: 'php_lint',
      label: `PHP lint (${phpFiles.length} file(s))`,
      ok: lintOk,
      skipped: false,
      output: lintOutputs.join('\n\n').slice(-4000),
    });
  }

  // T2 — PHPUnit (unit suite) if configured.
  const phpunit = path.join(cwd, 'vendor', 'bin', 'phpunit');
  const unitConfig = path.join(cwd, 'dev', 'tests', 'unit', 'phpunit.xml.dist');
  if (fs.existsSync(phpunit) && fs.existsSync(unitConfig)) {
    const r = await run(phpunit, ['-c', unitConfig], cwd);
    steps.push({
      key: 'phpunit',
      label: 'PHPUnit (unit suite)',
      ok: r.ok,
      skipped: false,
      output: r.output,
    });
  } else {
    steps.push({
      key: 'phpunit',
      label: 'PHPUnit (unit suite)',
      ok: true,
      skipped: true,
      output: 'vendor/bin/phpunit or dev/tests/unit/phpunit.xml.dist not found.',
    });
  }

  // T3 — DI compile is expensive; advisory only in this build.
  steps.push({
    key: 'di_compile',
    label: 'DI compile (setup:di:compile)',
    ok: true,
    skipped: true,
    output: 'Skipped by default (slow). Run manually if DI XML changed.',
  });

  const ok = steps.every((s) => s.ok || s.skipped);
  return { ranAt: new Date().toISOString(), ok, steps };
}
