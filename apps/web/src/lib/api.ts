import axios from 'axios';

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

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
