import { Router } from 'express';
import { z } from 'zod';
import { ActivityAction } from '@cpwork/shared';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { HttpError } from '../../lib/httpError.js';
import { encryptSecret } from '../../lib/crypto.js';
import { projectsRepo } from '../../db/repositories/projects.js';
import { projectRolesRepo } from '../../db/repositories/projectRoles.js';
import { environmentsRepo } from '../../db/repositories/environments.js';
import { activitiesRepo } from '../../db/repositories/activities.js';
import { resolveJira, testConnection } from '../jira/jira.service.js';
import { listFrontendThemes } from '../ai/repoContext.js';

/** Persist the Jira API token (encrypted) or clear it; ignore when undefined. */
function persistJiraToken(projectId: string, apiToken: string | null | undefined) {
  if (apiToken === undefined) return;
  if (apiToken === null || apiToken === '') {
    projectsRepo.setJiraTokenEnc(projectId, null);
  } else {
    projectsRepo.setJiraTokenEnc(projectId, encryptSecret(apiToken));
  }
}

const router = Router();
router.use(requireAuth, requireAdmin);

const defaultsSchema = z
  .object({
    projectRoot: z.string().optional(),
    frontendUrl: z.string().nullable().optional(),
    backendUrl: z.string().nullable().optional(),
    dockerComposePath: z.string().nullable().optional(),
    dockerPatchId: z.string().nullable().optional(),
  })
  .optional();

const gitSchema = z
  .object({
    remote: z.string().optional(),
    productionBranch: z.string().optional(),
    stagingBranch: z.string().optional(),
    prTargetBranch: z.string().optional(),
    commitMessageTemplate: z.string().optional(),
  })
  .optional();

const jiraSchema = z
  .object({
    baseUrl: z.string().nullable().optional(),
    projectKey: z.string().nullable().optional(),
    email: z.string().nullable().optional(),
    statusFilters: z.array(z.string()).optional(),
    assigneeFilter: z.string().nullable().optional(),
    apiToken: z.string().nullable().optional(),
  })
  .optional();

const createSchema = z.object({
  name: z.string().min(1),
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and dashes'),
  description: z.string().nullable().optional(),
  enabled: z.boolean().optional(),
  frontendTheme: z.string().nullable().optional(),
  defaults: defaultsSchema,
  git: gitSchema,
  jira: jiraSchema,
});

const updateSchema = createSchema.partial();

// GET /api/admin/projects
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const projects = projectsRepo.list().map((p) => ({
      ...p,
      userCount: projectRolesRepo.countUsersForProject(p.id),
      hasJiraToken: projectsRepo.hasJiraToken(p.id),
    }));
    res.json({ projects });
  }),
);

// POST /api/admin/projects
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    if (projectsRepo.findBySlug(input.slug)) {
      throw HttpError.conflict('Project slug already exists');
    }
    const project = projectsRepo.create(input);
    persistJiraToken(project.id, input.jira?.apiToken);
    activitiesRepo.create({
      userId: req.auth!.sub,
      username: req.auth!.username,
      action: ActivityAction.ProjectCreated,
      resourceType: 'project',
      resourceId: project.id,
      projectId: project.id,
      projectName: project.name,
      summary: `${req.auth!.username} created project ${project.name}`,
    });
    res.status(201).json({ project });
  }),
);

// PUT /api/admin/projects/:id
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = updateSchema.parse(req.body);
    const existing = projectsRepo.findById(req.params.id);
    if (!existing) throw HttpError.notFound('Project not found');

    if (input.slug && input.slug !== existing.slug) {
      const conflict = projectsRepo.findBySlug(input.slug);
      if (conflict && conflict.id !== existing.id) {
        throw HttpError.conflict('Project slug already exists');
      }
    }

    const project = projectsRepo.update(req.params.id, {
      name: input.name ?? existing.name,
      slug: input.slug ?? existing.slug,
      description: input.description,
      enabled: input.enabled,
      frontendTheme: input.frontendTheme,
      defaults: input.defaults,
      git: input.git,
      jira: input.jira,
    });
    persistJiraToken(req.params.id, input.jira?.apiToken);
    activitiesRepo.create({
      userId: req.auth!.sub,
      username: req.auth!.username,
      action: ActivityAction.ProjectUpdated,
      resourceType: 'project',
      resourceId: project!.id,
      projectId: project!.id,
      projectName: project!.name,
      summary: `${req.auth!.username} updated project ${project!.name}`,
    });
    res.json({ project });
  }),
);

// POST /api/admin/projects/:id/jira/test  (verify Jira credentials)
router.post(
  '/:id/jira/test',
  asyncHandler(async (req, res) => {
    const project = projectsRepo.findById(req.params.id);
    if (!project) throw HttpError.notFound('Project not found');

    const resolved = resolveJira(req.params.id);
    if (!resolved) {
      throw HttpError.badRequest(
        'Jira is not fully configured (need base URL, email, and API token)',
      );
    }
    const me = await testConnection(resolved.creds);
    res.json({
      ok: true,
      accountId: me.accountId,
      displayName: me.displayName,
    });
  }),
);

// GET /api/admin/projects/:id/themes  (detect frontend themes on disk)
router.get(
  '/:id/themes',
  asyncHandler(async (req, res) => {
    const project = projectsRepo.findById(req.params.id);
    if (!project) throw HttpError.notFound('Project not found');

    // Prefer the admin's own local checkout, else the project default root.
    const env = environmentsRepo.find(req.auth!.sub, project.id);
    const cwd = env?.projectRoot || project.defaults.projectRoot;
    const themes = cwd ? listFrontendThemes(cwd) : [];
    res.json({ themes, scannedPath: cwd || null });
  }),
);

// GET /api/admin/projects/:id/environments  (support view, read-only)
router.get(
  '/:id/environments',
  asyncHandler(async (req, res) => {
    const project = projectsRepo.findById(req.params.id);
    if (!project) throw HttpError.notFound('Project not found');
    res.json({ environments: environmentsRepo.listForProject(req.params.id) });
  }),
);

export default router;
