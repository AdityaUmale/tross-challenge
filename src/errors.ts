/**
 * Typed errors. Every failure path in the app maps onto one of these so routes
 * never have to guess a status code and never leak an upstream stack trace.
 */

export type ErrorCode =
  | 'INVALID_URL'
  | 'UNAUTHORIZED'
  | 'PROFILE_NOT_FOUND'
  | 'AUTH_EXPIRED'
  | 'RATE_LIMITED'
  | 'NO_HEALTHY_SESSION'
  | 'UPSTREAM_ERROR'
  | 'SCHEMA_DRIFT';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, status: number, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }

  toBody() {
    return {
      error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) },
    };
  }
}

/** The supplied URL is not a LinkedIn member profile. */
export class InvalidUrlError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('INVALID_URL', 400, message, details);
  }
}

/** Caller did not present a valid API key for *our* API. */
export class UnauthorizedError extends AppError {
  constructor(message = 'Missing or invalid API key.') {
    super('UNAUTHORIZED', 401, message);
  }
}

/** LinkedIn has no such profile, or will not show it to this session. */
export class ProfileNotFoundError extends AppError {
  constructor(identifier: string) {
    super('PROFILE_NOT_FOUND', 404, `No LinkedIn profile visible for "${identifier}".`, { identifier });
  }
}

/** The li_at cookie is dead, challenged, or rejected. */
export class AuthExpiredError extends AppError {
  constructor(message = 'LinkedIn rejected the session cookie. It has expired or been challenged.') {
    super('AUTH_EXPIRED', 401, message);
  }
}

/** LinkedIn throttled us (429) or tripped bot detection (999). */
export class RateLimitedError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('RATE_LIMITED', 429, message, details);
  }
}

/** Every configured session is in cooldown or dead. */
export class NoHealthySessionError extends AppError {
  constructor(message = 'No healthy LinkedIn session is available.') {
    super('NO_HEALTHY_SESSION', 503, message);
  }
}

/** LinkedIn returned 5xx, or something we could not interpret. */
export class UpstreamError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('UPSTREAM_ERROR', 502, message, details);
  }
}

/**
 * The payload parsed but did not contain what we expect — usually means a
 * decoration version or queryId has rotated and needs recapturing.
 */
export class SchemaDriftError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('SCHEMA_DRIFT', 502, `${message} (LinkedIn's response shape may have changed; recapture endpoints.)`, details);
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
