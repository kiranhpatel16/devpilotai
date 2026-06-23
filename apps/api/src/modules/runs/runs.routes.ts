import { Router } from 'express';
import { z } from 'zod';
import {
  ActivityAction,
  canWriteOnProject,
  isAdminRole,
  type AiProviderId,
  type GlobalRole,
  type JiraIssueDetail,
  type RunDetail,
} from '@cpwork/shared';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError } from '../../lib/httpError.js';
import { runsRepo } from '../../db/repositories/runs.js';
import { projectRolesRepo } from '../../db/repositories/projectRoles.js';
import { activitiesRepo } from '../../db/repositories/activities.js';
import { runUsageRepo } from '../../db/repositories/aiSettings.js';
import { resolveEnvironment } from '../environments/environment.service.js';
import { getIssueDetail } from '../jira/jira.service.js';
import { runAi } from '../ai/ai.service.js';
import { buildRepoContext } from '../ai/repoContext.js';
import { enabledProviderInfo } from '../ai/providers/registry.js';
import {
  applyChanges,
  captureBackups,
  commitAll,
  computeDiffs,
  createBranch,
  getStatus,
  pushBranch,
  revertChanges,
} from '../git/git.service.js';
import { createPullRequest } from '../git/pr.service.js';
import { runTests } from '../testing/test.service.js';
import { loadDetail, patchDetail } from './runDetail.js';
import { saveTaskPlan } from './taskPlanStorage.js';

const router = Router();
router.use(requireAuth);

const createSchema = z.object({
  projectId: z.string().min(1),
  jiraKey: z.string().nullable().optional(),
  mode: z.enum(['agent', 'plan', 'debug', 'ask']),
  provider: z.enum(['cursor', 'grok', 'openai', 'cloud_ai']).nullable().optional(),
  model: z.string().nullable().optional(),
  userInstructions: z.string().nullable().optional(),
  branchName: z.string().nullable().optional(),
});

function sanitizeBranch(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9._\-/]/g, '-');
}

function assertWriteAccess(userId: string, role: GlobalRole, projectId: string, agentMode: boolean) {
  if (isAdminRole(role)) return;
  const projectRole = projectRolesRepo.getRole(userId, projectId);
  if (!projectRole) throw HttpError.forbidden('You are not assigned to this project');
  if (agentMode && !canWriteOnProject(projectRole)) {
    throw HttpError.forbidden('Your project role cannot run Agent mode');
  }
}

function loadOwnedRun(runId: string, userId: string, role: GlobalRole) {
  const run = runsRepo.findById(runId);
  if (!run) throw HttpError.notFound('Run not found');
  if (run.userId !== userId && !isAdminRole(role)) throw HttpError.forbidden();
  return run;
}

function assembleDetail(runId: string): RunDetail {
  const run = runsRepo.findById(runId)!;
  const detail = loadDetail(runId);
  return {
    run,
    output: detail.output,
    diffs: detail.diffs,
    applied: detail.applied,
    canRevert: detail.applied && detail.backups.length > 0 && !detail.git?.committed,
    test: detail.test,
    git: detail.git,
    usage: detail.usage,
    error: runsRepo.getError(runId),
    planFilePath: detail.planFilePath ?? null,
  };
}

function pickProvider(requested?: AiProviderId | null): AiProviderId {
  if (requested) return requested;
  const enabled = enabledProviderInfo();
  if (enabled.length === 0) {
    throw HttpError.badRequest(
      'No AI provider is enabled. Configure one in Admin → AI Providers.',
    );
  }
  return enabled[0].id;
}

// GET /api/runs  (current user's run history)
router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json({ runs: runsRepo.listForUser(req.auth!.sub) });
  }),
);

// POST /api/runs  — start a run: branch (agent), call AI, compute diffs.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const role = req.auth!.role as GlobalRole;
    const agentMode = input.mode === 'agent';

    assertWriteAccess(req.auth!.sub, role, input.projectId, agentMode);
    const resolved = resolveEnvironment(req.auth!.sub, input.projectId);
    const provider = pickProvider(input.provider ?? null);

    const desiredBranch = (input.branchName ?? '').trim() || (input.jiraKey ?? '').trim();
    const branchName = agentMode && desiredBranch ? sanitizeBranch(desiredBranch) : null;

    const run = runsRepo.create({
      projectId: input.projectId,
      userId: req.auth!.sub,
      jiraKey: input.jiraKey ?? null,
      mode: input.mode,
      provider,
      model: input.model ?? null,
      userInstructions: input.userInstructions ?? null,
      branchName,
      status: agentMode ? 'branching' : 'analyzing',
    });

    activitiesRepo.create({
      userId: req.auth!.sub,
      username: req.auth!.username,
      action: ActivityAction.RunStarted,
      resourceType: 'run',
      resourceId: run.id,
      projectId: input.projectId,
      projectName: resolved.project.name,
      jiraKey: input.jiraKey ?? null,
      summary: `${req.auth!.username} started ${input.mode} run${
        input.jiraKey ? ` for ${input.jiraKey}` : ''
      }`,
      metadata: { mode: input.mode, provider },
    });

    try {
      // Fetch Jira context (best effort).
      let jira: JiraIssueDetail | null = null;
      if (input.jiraKey) {
        try {
          jira = await getIssueDetail(input.projectId, input.jiraKey);
        } catch {
          jira = null;
        }
      }

      // Create the branch for agent mode.
      if (agentMode && branchName) {
        await createBranch(resolved.cwd, branchName, resolved.project.git.productionBranch);
        runsRepo.updateStatus(run.id, 'analyzing');
      }

      // Ground the model in the real repository: themes, modules, and the
      // files most relevant to the task. This keeps it from inventing paths.
      const taskText = [
        jira?.summary,
        jira?.description,
        input.userInstructions,
        branchName,
      ]
        .filter(Boolean)
        .join(' ');
      const repo = buildRepoContext(
        resolved.cwd,
        taskText,
        resolved.project.frontendTheme,
      );

      const { output, usage } = await runAi(provider, input.model ?? null, {
        project: resolved.project,
        cwd: resolved.cwd,
        frontendUrl: resolved.frontendUrl,
        backendUrl: resolved.backendUrl,
        mode: input.mode,
        jira,
        jiraKey: input.jiraKey ?? null,
        userInstructions: input.userInstructions ?? null,
        activeTheme: resolved.project.frontendTheme,
        repoOverview: repo.overview,
        fileExcerpts: repo.excerpts,
      });

      runUsageRepo.record(run.id, usage);

      const diffs =
        agentMode && output.files.length
          ? computeDiffs(resolved.cwd, output.files)
          : [];

      const git = agentMode ? await getStatus(resolved.cwd, resolved.project.git.productionBranch) : null;
      if (git) git.branch = branchName;

      let planFilePath: string | null = null;
      if (input.mode === 'plan' && output.text) {
        const taskKey = (input.jiraKey ?? '').trim() || run.id;
        planFilePath = saveTaskPlan({
          projectSlug: resolved.project.slug,
          projectName: resolved.project.name,
          taskKey,
          planText: output.text,
        });
      }

      patchDetail(run.id, { output, diffs, git, usage, applied: false, planFilePath });
      runsRepo.updateStatus(
        run.id,
        agentMode ? 'awaiting_review' : 'done',
        output.summary || null,
      );

      res.status(201).json({ detail: assembleDetail(run.id) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Run failed';
      runsRepo.setError(run.id, message);
      runsRepo.updateStatus(run.id, 'failed');
      activitiesRepo.create({
        userId: req.auth!.sub,
        username: req.auth!.username,
        action: ActivityAction.RunFailed,
        resourceType: 'run',
        resourceId: run.id,
        projectId: input.projectId,
        projectName: resolved.project.name,
        summary: `Run ${run.id} failed: ${message}`,
      });
      throw err;
    }
  }),
);

// GET /api/runs/:id
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    loadOwnedRun(req.params.id, req.auth!.sub, req.auth!.role as GlobalRole);
    res.json({ detail: assembleDetail(req.params.id) });
  }),
);

const applySchema = z.object({ paths: z.array(z.string()).optional() });

// POST /api/runs/:id/apply
router.post(
  '/:id/apply',
  asyncHandler(async (req, res) => {
    const run = loadOwnedRun(req.params.id, req.auth!.sub, req.auth!.role as GlobalRole);
    if (run.mode !== 'agent') throw HttpError.badRequest('Only agent runs can be applied');
    const { paths } = applySchema.parse(req.body ?? {});
    const detail = loadDetail(run.id);
    if (!detail.output?.files.length) throw HttpError.badRequest('No proposed changes to apply');

    const resolved = resolveEnvironment(run.userId, run.projectId);
    const backups = captureBackups(resolved.cwd, detail.output.files, paths);
    applyChanges(resolved.cwd, detail.output.files, paths);
    const git = await getStatus(resolved.cwd, resolved.project.git.productionBranch);
    git.branch = run.branchName;

    patchDetail(run.id, { applied: true, git, backups });
    runsRepo.updateStatus(run.id, 'testing');
    activitiesRepo.create({
      userId: req.auth!.sub,
      username: req.auth!.username,
      action: ActivityAction.RunApplied,
      resourceType: 'run',
      resourceId: run.id,
      projectId: run.projectId,
      jiraKey: run.jiraKey,
      summary: `${req.auth!.username} applied changes for ${run.jiraKey ?? run.id}`,
    });
    res.json({ detail: assembleDetail(run.id) });
  }),
);

const refineSchema = z.object({ instructions: z.string().min(1) });

// POST /api/runs/:id/refine  — iterate on the current proposal with more detail
router.post(
  '/:id/refine',
  asyncHandler(async (req, res) => {
    const run = loadOwnedRun(req.params.id, req.auth!.sub, req.auth!.role as GlobalRole);
    if (run.mode !== 'agent') throw HttpError.badRequest('Only agent runs can be refined');
    const { instructions } = refineSchema.parse(req.body);

    const detail = loadDetail(run.id);
    if (!detail.output) throw HttpError.badRequest('No existing proposal to refine');
    if (detail.applied) {
      throw HttpError.badRequest('Revert the applied changes before refining the proposal');
    }

    const resolved = resolveEnvironment(run.userId, run.projectId);
    const provider = pickProvider(run.provider);

    try {
      const taskText = [
        run.jiraKey,
        run.userInstructions,
        detail.output.summary,
        instructions,
        run.branchName,
      ]
        .filter(Boolean)
        .join(' ');
      const repo = buildRepoContext(resolved.cwd, taskText, resolved.project.frontendTheme);

      const { output, usage } = await runAi(provider, run.model, {
        project: resolved.project,
        cwd: resolved.cwd,
        frontendUrl: resolved.frontendUrl,
        backendUrl: resolved.backendUrl,
        mode: 'agent',
        jira: null,
        jiraKey: run.jiraKey,
        userInstructions: run.userInstructions,
        activeTheme: resolved.project.frontendTheme,
        repoOverview: repo.overview,
        fileExcerpts: repo.excerpts,
        priorOutput: detail.output,
        refineInstructions: instructions,
      });

      runUsageRepo.record(run.id, usage);
      const diffs = output.files.length ? computeDiffs(resolved.cwd, output.files) : [];
      patchDetail(run.id, { output, diffs, usage, applied: false, backups: [], test: null });
      runsRepo.setError(run.id, null);
      runsRepo.updateStatus(run.id, 'awaiting_review', output.summary || null);
      res.json({ detail: assembleDetail(run.id) });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Refine failed';
      runsRepo.setError(run.id, message);
      throw err;
    }
  }),
);

// POST /api/runs/:id/revert  — restore the working tree to its pre-apply state
router.post(
  '/:id/revert',
  asyncHandler(async (req, res) => {
    const run = loadOwnedRun(req.params.id, req.auth!.sub, req.auth!.role as GlobalRole);
    const detail = loadDetail(run.id);
    if (!detail.applied || detail.backups.length === 0) {
      throw HttpError.badRequest('Nothing to revert');
    }
    if (detail.git?.committed) {
      throw HttpError.badRequest(
        'Changes were already committed. Use `git revert`/`git reset` in the project to undo a commit.',
      );
    }

    const resolved = resolveEnvironment(run.userId, run.projectId);
    revertChanges(resolved.cwd, detail.backups);
    const git = await getStatus(resolved.cwd, resolved.project.git.productionBranch);
    git.branch = run.branchName;

    patchDetail(run.id, { applied: false, backups: [], git, test: null });
    runsRepo.updateStatus(run.id, 'awaiting_review');
    activitiesRepo.create({
      userId: req.auth!.sub,
      username: req.auth!.username,
      action: ActivityAction.RunRejected,
      resourceType: 'run',
      resourceId: run.id,
      projectId: run.projectId,
      jiraKey: run.jiraKey,
      summary: `${req.auth!.username} reverted applied changes for ${run.jiraKey ?? run.id}`,
    });
    res.json({ detail: assembleDetail(run.id) });
  }),
);

// POST /api/runs/:id/test
router.post(
  '/:id/test',
  asyncHandler(async (req, res) => {
    const run = loadOwnedRun(req.params.id, req.auth!.sub, req.auth!.role as GlobalRole);
    const resolved = resolveEnvironment(run.userId, run.projectId);
    const detail = loadDetail(run.id);
    const changed = detail.output?.files.map((f) => f.path) ?? [];
    const report = await runTests(resolved.cwd, changed, resolved.env.phpBin ?? 'php');
    patchDetail(run.id, { test: report });
    if (report.ok) runsRepo.updateStatus(run.id, 'commit_ready');
    res.json({ detail: assembleDetail(run.id) });
  }),
);

const commitSchema = z.object({ message: z.string().min(1) });

// POST /api/runs/:id/commit
router.post(
  '/:id/commit',
  asyncHandler(async (req, res) => {
    const run = loadOwnedRun(req.params.id, req.auth!.sub, req.auth!.role as GlobalRole);
    const { message } = commitSchema.parse(req.body);
    const resolved = resolveEnvironment(run.userId, run.projectId);

    await commitAll(resolved.cwd, message);
    const git = await getStatus(resolved.cwd, resolved.project.git.productionBranch);
    git.branch = run.branchName;
    git.committed = true;
    git.commitMessage = message;
    patchDetail(run.id, { git });
    runsRepo.updateStatus(run.id, 'pushing');
    activitiesRepo.create({
      userId: req.auth!.sub,
      username: req.auth!.username,
      action: ActivityAction.RunCommitted,
      resourceType: 'run',
      resourceId: run.id,
      projectId: run.projectId,
      jiraKey: run.jiraKey,
      summary: `${req.auth!.username} committed ${run.jiraKey ?? run.id}`,
    });
    res.json({ detail: assembleDetail(run.id) });
  }),
);

// POST /api/runs/:id/push
router.post(
  '/:id/push',
  asyncHandler(async (req, res) => {
    const run = loadOwnedRun(req.params.id, req.auth!.sub, req.auth!.role as GlobalRole);
    if (!run.branchName) throw HttpError.badRequest('Run has no branch to push');
    const resolved = resolveEnvironment(run.userId, run.projectId);
    await pushBranch(resolved.cwd, run.branchName, resolved.project.git.remote);
    const detail = loadDetail(run.id);
    const git = detail.git ?? (await getStatus(resolved.cwd, resolved.project.git.productionBranch));
    git.pushed = true;
    patchDetail(run.id, { git });
    runsRepo.updateStatus(run.id, 'pr_creating');
    activitiesRepo.create({
      userId: req.auth!.sub,
      username: req.auth!.username,
      action: ActivityAction.RunPushed,
      resourceType: 'run',
      resourceId: run.id,
      projectId: run.projectId,
      jiraKey: run.jiraKey,
      summary: `${req.auth!.username} pushed ${run.branchName}`,
    });
    res.json({ detail: assembleDetail(run.id) });
  }),
);

// POST /api/runs/:id/pr  — open a PR to the staging branch
router.post(
  '/:id/pr',
  asyncHandler(async (req, res) => {
    const run = loadOwnedRun(req.params.id, req.auth!.sub, req.auth!.role as GlobalRole);
    if (!run.branchName) throw HttpError.badRequest('Run has no branch');
    const resolved = resolveEnvironment(run.userId, run.projectId);
    const detail = loadDetail(run.id);

    const title = `[${run.jiraKey ?? run.branchName}] ${detail.output?.summary ?? 'CPWork change'}`;
    const body = [
      run.jiraKey && resolved.project.jira.baseUrl
        ? `## Jira\n[${run.jiraKey}](${resolved.project.jira.baseUrl.replace(/\/+$/, '')}/browse/${run.jiraKey})`
        : '',
      `## Summary\n${detail.output?.summary ?? ''}`,
      detail.output?.files.length
        ? `## Files\n${detail.output.files.map((f) => `- ${f.action}: ${f.path}`).join('\n')}`
        : '',
      detail.test
        ? `## Tests\n${detail.test.steps.map((s) => `- ${s.label}: ${s.skipped ? 'skipped' : s.ok ? 'pass' : 'FAIL'}`).join('\n')}`
        : '',
      detail.output?.manualTestChecklist.length
        ? `## Manual checklist\n${detail.output.manualTestChecklist.map((c) => `- [ ] ${c}`).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const url = await createPullRequest(
      resolved.cwd,
      resolved.project.git.prTargetBranch,
      run.branchName,
      title,
      body,
    );

    const git = detail.git ?? (await getStatus(resolved.cwd, resolved.project.git.productionBranch));
    git.prUrl = url;
    patchDetail(run.id, { git });
    runsRepo.updateStatus(run.id, 'done');
    activitiesRepo.create({
      userId: req.auth!.sub,
      username: req.auth!.username,
      action: ActivityAction.RunPrCreated,
      resourceType: 'run',
      resourceId: run.id,
      projectId: run.projectId,
      jiraKey: run.jiraKey,
      summary: `${req.auth!.username} opened staging PR for ${run.jiraKey ?? run.branchName}`,
      metadata: { url },
    });
    res.json({ detail: assembleDetail(run.id), prUrl: url });
  }),
);

export default router;
