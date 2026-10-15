import type { ApiError, SessionInfo } from '@orbit/core';

export type ApiCode = ApiError['error']['code'] | 'NETWORK';

export class ApiRequestError extends Error {
  readonly code: ApiCode;
  readonly retryable: boolean;
  readonly status: number;
  constructor(code: ApiCode, message: string, retryable: boolean, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

export type Query = Record<string, string | number | boolean | null | undefined>;

export function buildUrl(path: string, query?: Query): string {
  if (!query) return path;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `${path}?${s}` : path;
}

async function parseError(res: Response): Promise<ApiRequestError> {
  let code: ApiCode = 'INTERNAL';
  let message = res.statusText;
  let retryable = res.status >= 500;
  try {
    const body = (await res.json()) as Partial<ApiError>;
    if (body.error) {
      code = body.error.code;
      message = body.error.message;
      retryable = body.error.retryable;
    }
  } catch {
    /* non-JSON error body */
  }
  return new ApiRequestError(code, message, retryable, res.status);
}

async function request(path: string, init: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...init });
  } catch {
    throw new ApiRequestError('NETWORK', 'network', true, 0);
  }
  if (!res.ok) throw await parseError(res);
  return res;
}

export async function apiGet<T>(path: string, query?: Query, signal?: AbortSignal): Promise<T> {
  const res = await request(buildUrl(path, query), { headers: { accept: 'application/json' }, ...(signal ? { signal } : {}) });
  return (await res.json()) as T;
}

let csrfPromise: Promise<string> | null = null;
export function getCsrf(force = false): Promise<string> {
  if (force || !csrfPromise) {
    csrfPromise = apiGet<SessionInfo>('/api/v1/session').then((s) => s.csrfToken);
    csrfPromise.catch(() => {
      csrfPromise = null;
    });
  }
  return csrfPromise;
}
export function resetCsrfForTests() {
  csrfPromise = null;
}

export async function apiSend<T>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const attempt = async (force: boolean): Promise<T> => {
    const token = await getCsrf(force);
    const res = await request(path, {
      method,
      headers: { accept: 'application/json', 'x-orbit-csrf': token, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  };
  try {
    return await attempt(false);
  } catch (e) {
    if (e instanceof ApiRequestError && e.code === 'CSRF_REQUIRED') return attempt(true);
    throw e;
  }
}
