import { Router } from 'express';
import { z } from 'zod';
import {
  ActivityAction,
  GLOBAL_ROLES,
  GlobalRole,
  PROJECT_ROLES,
  ProjectRole,
} from '@cpwork/shared';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { HttpError } from '../../lib/httpError.js';
import { hashPassword, validatePasswordStrength } from '../../lib/password.js';
import { usersRepo, toPublicUser } from '../../db/repositories/users.js';
import { projectRolesRepo } from '../../db/repositories/projectRoles.js';
import { activitiesRepo } from '../../db/repositories/activities.js';

const router = Router();
router.use(requireAuth, requireAdmin);

const createSchema = z.object({
  username: z.string().min(3).max(64),
  displayName: z.string().min(1),
  email: z.string().email().optional().nullable(),
  password: z.string().min(10),
  globalRole: z.enum(GLOBAL_ROLES as [GlobalRole, ...GlobalRole[]]),
});

const updateSchema = z.object({
  displayName: z.string().min(1).optional(),
  email: z.string().email().nullable().optional(),
  globalRole: z.enum(GLOBAL_ROLES as [GlobalRole, ...GlobalRole[]]).optional(),
  status: z.enum(['active', 'disabled', 'locked']).optional(),
});

const rolesSchema = z.object({
  assignments: z.array(
    z.object({
      projectId: z.string().min(1),
      role: z.enum(PROJECT_ROLES as [ProjectRole, ...ProjectRole[]]),
    }),
  ),
});

const resetPwSchema = z.object({
  newPassword: z.string().min(10),
  mustChange: z.boolean().optional(),
});

// GET /api/admin/users
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const users = usersRepo.list().map((u) => ({
      ...u,
      projectRoles: projectRolesRepo.listForUser(u.id),
    }));
    res.json({ users });
  }),
);

// POST /api/admin/users
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const input = createSchema.parse(req.body);
    const pwError = validatePasswordStrength(input.password);
    if (pwError) throw HttpError.badRequest(pwError);

    if (usersRepo.findByUsername(input.username)) {
      throw HttpError.conflict('Username already exists');
    }

    const passwordHash = await hashPassword(input.password);
    const user = usersRepo.create({
      username: input.username,
      displayName: input.displayName,
      email: input.email ?? null,
      passwordHash,
      globalRole: input.globalRole,
      mustChangePassword: true,
    });

    activitiesRepo.create({
      userId: req.auth!.sub,
      username: req.auth!.username,
      action: ActivityAction.UserCreated,
      resourceType: 'user',
      resourceId: user.id,
      summary: `${req.auth!.username} created user ${user.username}`,
    });

    res.status(201).json({ user: toPublicUser(user) });
  }),
);

// PUT /api/admin/users/:id
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const input = updateSchema.parse(req.body);
    const target = usersRepo.findById(req.params.id);
    if (!target) throw HttpError.notFound('User not found');

    // Protect the last super admin from being demoted/disabled.
    const demoting =
      target.globalRole === GlobalRole.SuperAdmin &&
      ((input.globalRole && input.globalRole !== GlobalRole.SuperAdmin) ||
        input.status === 'disabled');
    if (demoting && usersRepo.countByRole(GlobalRole.SuperAdmin) <= 1) {
      throw HttpError.badRequest('Cannot demote or disable the last super admin');
    }

    const updated = usersRepo.update(req.params.id, input);
    activitiesRepo.create({
      userId: req.auth!.sub,
      username: req.auth!.username,
      action: ActivityAction.UserUpdated,
      resourceType: 'user',
      resourceId: target.id,
      summary: `${req.auth!.username} updated user ${target.username}`,
    });
    res.json({ user: toPublicUser(updated!) });
  }),
);

// GET /api/admin/users/:id/project-roles
router.get(
  '/:id/project-roles',
  asyncHandler(async (req, res) => {
    if (!usersRepo.findById(req.params.id)) throw HttpError.notFound('User not found');
    res.json({ assignments: projectRolesRepo.listForUser(req.params.id) });
  }),
);

// PUT /api/admin/users/:id/project-roles
router.put(
  '/:id/project-roles',
  asyncHandler(async (req, res) => {
    const { assignments } = rolesSchema.parse(req.body);
    const target = usersRepo.findById(req.params.id);
    if (!target) throw HttpError.notFound('User not found');

    projectRolesRepo.setForUser(req.params.id, assignments, req.auth!.sub);
    activitiesRepo.create({
      userId: req.auth!.sub,
      username: req.auth!.username,
      action: ActivityAction.UserRoleChanged,
      resourceType: 'user',
      resourceId: target.id,
      summary: `${req.auth!.username} updated project roles for ${target.username}`,
      metadata: { count: assignments.length },
    });
    res.json({ assignments: projectRolesRepo.listForUser(req.params.id) });
  }),
);

// POST /api/admin/users/:id/reset-password
router.post(
  '/:id/reset-password',
  asyncHandler(async (req, res) => {
    const { newPassword, mustChange } = resetPwSchema.parse(req.body);
    const pwError = validatePasswordStrength(newPassword);
    if (pwError) throw HttpError.badRequest(pwError);

    const target = usersRepo.findById(req.params.id);
    if (!target) throw HttpError.notFound('User not found');

    const passwordHash = await hashPassword(newPassword);
    usersRepo.update(req.params.id, {
      passwordHash,
      mustChangePassword: mustChange ?? true,
    });

    activitiesRepo.create({
      userId: req.auth!.sub,
      username: req.auth!.username,
      action: ActivityAction.AuthPasswordReset,
      resourceType: 'user',
      resourceId: target.id,
      summary: `${req.auth!.username} reset password for ${target.username}`,
    });
    res.json({ ok: true });
  }),
);

export default router;
