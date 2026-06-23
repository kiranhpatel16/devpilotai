import bcrypt from 'bcryptjs';
import { config } from '../config.js';

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, config.bcryptRounds);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Minimal password policy. Returns an error message or null if valid. */
export function validatePasswordStrength(plain: string): string | null {
  if (plain.length < 10) return 'Password must be at least 10 characters';
  return null;
}
