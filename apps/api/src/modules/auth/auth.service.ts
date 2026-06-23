import type { AuthSession, PublicUser } from '@cpwork/shared';
import { HttpError } from '../../lib/httpError.js';
import { verifyPassword } from '../../lib/password.js';
import { usersRepo, toPublicUser } from '../../db/repositories/users.js';
import { projectRolesRepo } from '../../db/repositories/projectRoles.js';
import { nowIso } from '../../db/index.js';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export interface LoginResult {
  user: PublicUser;
}

export async function authenticate(
  username: string,
  password: string,
): Promise<PublicUser> {
  const user = usersRepo.findByUsername(username);
  if (!user) throw HttpError.unauthorized('Invalid username or password');

  if (user.status === 'disabled') {
    throw HttpError.forbidden('Account is disabled');
  }

  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    throw HttpError.forbidden('Account is temporarily locked. Try again later.');
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) {
    const attempts = user.failedLoginAttempts + 1;
    const lockedUntil =
      attempts >= MAX_FAILED
        ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString()
        : null;
    usersRepo.recordLoginFailure(user.id, attempts, lockedUntil);
    if (lockedUntil) {
      throw HttpError.forbidden('Too many failed attempts. Account locked for 15 minutes.');
    }
    throw HttpError.unauthorized('Invalid username or password');
  }

  usersRepo.recordLoginSuccess(user.id);
  return toPublicUser({ ...user, lastLoginAt: nowIso() });
}

export function buildSession(userId: string): AuthSession {
  const user = usersRepo.findById(userId);
  if (!user) throw HttpError.unauthorized();
  return {
    user: toPublicUser(user),
    projectRoles: projectRolesRepo.listForUser(userId),
  };
}
