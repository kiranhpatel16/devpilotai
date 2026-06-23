import type { NextFunction, Request, Response } from 'express';
import { isAdminRole, type GlobalRole } from '@cpwork/shared';
import { AUTH_COOKIE, verifyToken, type JwtPayload } from '../lib/jwt.js';
import { HttpError } from '../lib/httpError.js';
import { usersRepo } from '../db/repositories/users.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: JwtPayload;
    }
  }
}

function extractToken(req: Request): string | null {
  const cookieToken = req.cookies?.[AUTH_COOKIE];
  if (cookieToken) return cookieToken;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

/** Require a valid session. Populates req.auth. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) throw HttpError.unauthorized();
  const payload = verifyToken(token);
  if (!payload) throw HttpError.unauthorized('Invalid or expired session');

  const user = usersRepo.findById(payload.sub);
  if (!user || user.status !== 'active') {
    throw HttpError.unauthorized('Account is not active');
  }
  req.auth = payload;
  next();
}

/** Require an admin-level global role (super_admin or admin). */
export function requireAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) throw HttpError.unauthorized();
  if (!isAdminRole(req.auth.role as GlobalRole)) {
    throw HttpError.forbidden('Admin access required');
  }
  next();
}
