import { Router } from 'express';
import { z } from 'zod';
import { ActivityAction, isAdminRole, type GlobalRole } from '@cpwork/shared';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { requireAuth } from '../../middleware/auth.js';
import { HttpError } from '../../lib/httpError.js';
import { encryptSecret } from '../../lib/crypto.js';
import { projectsRepo } from '../../db/repositories/projects.js';
import { projectRolesRepo } from '../../db/repositories/projectRoles.js';
import { environmentsRepo } from '../../db/repositories/environments.js';
import { activitiesRepo } from '../../db/repositories/activities.js';
import {
  checkEnvironmentPath,
  resolveEnvironment,
} from '../environments/environment.service.js';

const router = Router();
router.use(requireAuth);

/** Projects visible to the current user (all for admins, assigned for others). */
function visibleProjects(userId: string, role: GlobalRole) {
  if (isAdminRole(role)) return projectsRepo.list();
  const assignments = projectRolesRepo.listForUser(userId);
  return projectsRepo.listByIds(assignments.map((a) => a.projectId));
}

function assertProjectAccess(userId: string, role: GlobalRole, projectId: string) {
  if (isAdminRole(role)) return;
  const projectRole = projectRolesRepo.getRole(userId, projectId);
  if (!projectRole) throw HttpError.forbidden('You are not assigned to this project');
}

// GET /api/projects
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const projects = visibleProjects(req.auth!.sub, req.auth!.role as GlobalRole);
    const withEnv = projects.map((p) => {
      const env = environmentsRepo.find(req.auth!.sub, p.id);
      return {
        ...p,
        myRole: projectRolesRepo.getRole(req.auth!.sub, p.id),
        hasEnvironment: !!env,
        environmentVerified: !!env?.pathVerifiedAt,
      };
    });
    res.json({ projects: withEnv });
  }),
);

// GET /api/projects/:id
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    assertProjectAccess(req.auth!.sub, req.auth!.role as GlobalRole, req.params.id);
    const project = projectsRepo.findById(req.params.id);
    if (!project) throw HttpError.notFound('Project not found');
    res.json({
      project,
      myRole: projectRolesRepo.getRole(req.auth!.sub, project.id),
      myEnvironment: environmentsRepo.find(req.auth!.sub, project.id),
    });
  }),
);

// GET /api/projects/:id/my-environment
router.get(
  '/:id/my-environment',
  asyncHandler(async (req, res) => {
    assertProjectAccess(req.auth!.sub, req.auth!.role as GlobalRole, req.params.id);
    const project = projectsRepo.findById(req.params.id);
    if (!project) throw HttpError.notFound('Project not found');
    res.json({
      environment: environmentsRepo.find(req.auth!.sub, project.id),
      defaults: project.defaults,
    });
  }),
);

const envSchema = z.object({
  projectRoot: z.string().min(1),
  frontendUrl: z.string().nullable().optional(),
  backendUrl: z.string().nullable().optional(),
  databaseHost: z.string().nullable().optional(),
  databasePort: z.number().int().nullable().optional(),
  databaseName: z.string().nullable().optional(),
  databaseUser: z.string().nullable().optional(),
  databasePassword: z.string().nullable().optional(),
  dockerComposePath: z.string().nullable().optional(),
  phpBin: z.string().nullable().optional(),
});

// PUT /api/projects/:id/my-environment
router.put(
  '/:id/my-environment',
  asyncHandler(async (req, res) => {
    assertProjectAccess(req.auth!.sub, req.auth!.role as GlobalRole, req.params.id);
    const project = projectsRepo.findById(req.params.id);
    if (!project) throw HttpError.notFound('Project not found');

    const input = envSchema.parse(req.body);
    const env = environmentsRepo.upsert(req.auth!.sub, project.id, {
      projectRoot: input.projectRoot,
      frontendUrl: input.frontendUrl ?? null,
      backendUrl: input.backendUrl ?? null,
      databaseHost: input.databaseHost ?? null,
      databasePort: input.databasePort ?? null,
      databaseName: input.databaseName ?? null,
      databaseUser: input.databaseUser ?? null,
      databasePasswordEnc: input.databasePassword
        ? encryptSecret(input.databasePassword)
        : null,
      dockerComposePath: input.dockerComposePath ?? null,
      phpBin: input.phpBin ?? null,
    });

    activitiesRepo.create({
      userId: req.auth!.sub,
      username: req.auth!.username,
      action: ActivityAction.UserEnvironmentUpdated,
      resourceType: 'environment',
      resourceId: env.id,
      projectId: project.id,
      projectName: project.name,
      summary: `${req.auth!.username} updated local environment for ${project.name}`,
      metadata: { projectRoot: input.projectRoot },
    });

    res.json({ environment: env });
  }),
);

// POST /api/projects/:id/my-environment/test
router.post(
  '/:id/my-environment/test',
  asyncHandler(async (req, res) => {
    assertProjectAccess(req.auth!.sub, req.auth!.role as GlobalRole, req.params.id);
    const project = projectsRepo.findById(req.params.id);
    if (!project) throw HttpError.notFound('Project not found');

    // Allow testing a candidate path from the body, else the saved one.
    const candidate = z
      .object({ projectRoot: z.string().optional(), phpBin: z.string().optional() })
      .parse(req.body ?? {});

    const saved = environmentsRepo.find(req.auth!.sub, project.id);
    const projectRoot = candidate.projectRoot ?? saved?.projectRoot ?? '';
    if (!projectRoot) throw HttpError.badRequest('No project path to test');

    const health = checkEnvironmentPath(projectRoot, candidate.phpBin ?? saved?.phpBin);

    if (saved) {
      environmentsRepo.saveHealth(req.auth!.sub, project.id, health);
    }
    res.json({ health });
  }),
);

// GET /api/projects/:id/health  (uses resolved env path)
router.get(
  '/:id/health',
  asyncHandler(async (req, res) => {
    assertProjectAccess(req.auth!.sub, req.auth!.role as GlobalRole, req.params.id);
    const resolved = resolveEnvironment(req.auth!.sub, req.params.id);
    const health = checkEnvironmentPath(resolved.cwd, resolved.env.phpBin);
    environmentsRepo.saveHealth(req.auth!.sub, req.params.id, health);
    res.json({ health, cwd: resolved.cwd });
  }),
);

export default router;
