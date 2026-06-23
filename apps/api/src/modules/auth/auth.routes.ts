import { Router } from 'express';
import { z } from 'zod';
import { ActivityAction } from '@cpwork/shared';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import { requireAuth } from '../../middleware/auth.js';
import { AUTH_COOKIE, signToken } from '../../lib/jwt.js';
import { isProd } from '../../config.js';
import { activitiesRepo } from '../../db/repositories/activities.js';
import { usersRepo } from '../../db/repositories/users.js';
import { authenticate, buildSession } from './auth.service.js';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { username, password } = loginSchema.parse(req.body);
    const user = await authenticate(username, password);

    const token = signToken({
      sub: user.id,
      username: user.username,
      role: user.globalRole,
    });

    res.cookie(AUTH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 8 * 60 * 60 * 1000,
    });

    activitiesRepo.create({
      userId: user.id,
      username: user.username,
      action: ActivityAction.AuthLogin,
      summary: `${user.username} logged in`,
      ipAddress: req.ip ?? null,
    });

    res.json({ ...buildSession(user.id), token });
  }),
);

router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.clearCookie(AUTH_COOKIE);
    activitiesRepo.create({
      userId: req.auth!.sub,
      username: req.auth!.username,
      action: ActivityAction.AuthLogout,
      summary: `${req.auth!.username} logged out`,
      ipAddress: req.ip ?? null,
    });
    res.json({ ok: true });
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(buildSession(req.auth!.sub));
  }),
);

const jiraAccountSchema = z.object({
  jiraAccountId: z.string().trim().max(128).nullable(),
});

// PUT /api/auth/me/jira-account  (user sets their own Jira identity)
router.put(
  '/me/jira-account',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { jiraAccountId } = jiraAccountSchema.parse(req.body);
    usersRepo.setJiraAccountId(req.auth!.sub, jiraAccountId || null);
    res.json(buildSession(req.auth!.sub));
  }),
);

export default router;
