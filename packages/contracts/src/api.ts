import { z } from 'zod';

export const ApiErrorCode = z.enum([
  'bad_request',
  'unauthenticated',
  'forbidden',
  'not_found',
  'conflict',
  'quota_exceeded',
  'payload_too_large',
  'internal',
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

/** Error envelope returned by every /api endpoint. `message` is safe to show (Japanese). */
export const ApiError = z.strictObject({
  error: z.strictObject({
    code: ApiErrorCode,
    message: z.string(),
    retryable: z.boolean(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export function apiError(code: ApiErrorCode, message: string, retryable = false): ApiError {
  return { error: { code, message, retryable } };
}
