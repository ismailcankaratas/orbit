import type { ApiError } from '@orbit/core';

/**
 * `SOURCE_NOT_ALLOWED` is declared locally until packages/core's ApiError union includes it (see handoff).
 */
export type ApiErrorCode = ApiError['error']['code'] | 'SOURCE_NOT_ALLOWED';

/** Error with a safe, sanitized message. Never carries paths, stack traces or source text. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'HttpError';
  }

  toBody(): ApiError {
    return { error: { code: this.code as ApiError['error']['code'], message: this.message, retryable: this.retryable } };
  }
}
