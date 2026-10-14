export type AmdErrorKind = 'timeout' | 'aborted' | 'network' | 'http' | 'malformed';

/**
 * Controlled adapter failure. Messages are sanitized: they never include headers, keys, request
 * payloads or provider metadata, so they are safe to log and store as a job's safe error.
 */
export class AmdError extends Error {
  readonly kind: AmdErrorKind;
  readonly status: number | undefined;
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;

  constructor(
    kind: AmdErrorKind,
    message: string,
    options: { status?: number; retryable?: boolean; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = 'AmdError';
    this.kind = kind;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** Timeouts, 429 and transient 5xx are retryable; authentication and malformed requests are not. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export function parseRetryAfterMs(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
