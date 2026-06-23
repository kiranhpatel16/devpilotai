import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../lib/httpError.js';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: err.message,
      code: err.code,
      details: err.details,
    });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      code: 'validation_error',
      details: err.flatten(),
    });
  }
  console.error('[cpwork] Unhandled error:', err);
  return res.status(500).json({ error: 'Internal server error', code: 'internal' });
}
