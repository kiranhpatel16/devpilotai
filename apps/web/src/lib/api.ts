import axios from 'axios';

/** Fast-fail when the API is unresponsive (auth, health checks). */
export const QUICK_TIMEOUT_MS = 8_000;

/** AI agents, plan generation, deploy, and other long backend work. */
export const LONG_TIMEOUT_MS = 600_000;

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

/** Pass as the third argument to axios calls that may run for minutes. */
export const longRequest = { timeout: LONG_TIMEOUT_MS };

export interface ApiErrorShape {
  error: string;
  code?: string;
  details?: unknown;
}

export function getApiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as ApiErrorShape | undefined;
    return data?.error ?? err.message;
  }
  if (err instanceof Error) return err.message;
  return 'Unexpected error';
}

export function getApiErrorCode(err: unknown): string | undefined {
  if (axios.isAxiosError(err)) {
    return (err.response?.data as ApiErrorShape | undefined)?.code;
  }
  return undefined;
}
