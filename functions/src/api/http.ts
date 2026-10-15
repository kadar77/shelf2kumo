import { apiError, type ApiErrorCode } from '@shelf2kumo/contracts';
import type { z } from 'zod';

/** JSON command bodies are small; anything larger is rejected before parsing work. */
export const MAX_JSON_BODY_BYTES = 64 * 1024;

export interface ApiRequest {
  method: string;
  path: string;
  header(name: string): string | undefined;
  body: unknown;
  rawBodyBytes: number;
}

export interface ApiResponse {
  status: number;
  body: unknown;
}

/** A controlled failure with a safe Japanese message for the error envelope. */
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
}

export function errorResponse(error: HttpError): ApiResponse {
  return { status: error.status, body: apiError(error.code, error.message, error.retryable) };
}

/** Validates a request body against a shared contract. Field-level messages come from the same schema on the client. */
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) throw new HttpError(400, 'bad_request', '入力内容を確認してください。');
  return result.data;
}

export const notFound = () => new HttpError(404, 'not_found', '見つかりませんでした。');
