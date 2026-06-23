import jwt from 'jsonwebtoken';
import type { GlobalRole } from '@cpwork/shared';
import { config } from '../config.js';

export interface JwtPayload {
  sub: string; // user id
  username: string;
  role: GlobalRole;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  } as jwt.SignOptions);
}

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, config.jwtSecret) as JwtPayload;
  } catch {
    return null;
  }
}

export const AUTH_COOKIE = 'cpwork_token';
