import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load the root .env (two levels up from apps/api/src).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootEnvPath = path.resolve(__dirname, '../../../.env');
dotenv.config({ path: rootEnvPath });
dotenv.config(); // also pick up a local .env if present

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const repoRoot = path.resolve(__dirname, '../../..');

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.API_PORT ?? 3000),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  repoRoot,

  databaseFile: path.isAbsolute(process.env.DATABASE_FILE ?? '')
    ? (process.env.DATABASE_FILE as string)
    : path.resolve(repoRoot, process.env.DATABASE_FILE ?? './data/cpwork.db'),

  jwtSecret: required('JWT_SECRET', 'dev-insecure-secret-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  bcryptRounds: Number(process.env.BCRYPT_ROUNDS ?? 12),

  masterKey: process.env.CPWORK_MASTER_KEY ?? '0'.repeat(64),

  seedAdmin: {
    username: process.env.SEED_ADMIN_USERNAME ?? 'admin',
    password: process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!',
    displayName: process.env.SEED_ADMIN_NAME ?? 'Administrator',
  },
} as const;

export const isProd = config.env === 'production';
