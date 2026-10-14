import { apiError, type ApiError } from '@shelf2kumo/contracts';

export interface ApiResponse {
  status: number;
  body: unknown;
}

/**
 * Phase 0 API surface: health check only. Authenticated commands (token, App Check, ownership,
 * revision checks) arrive in Phase 1. Responses are always `private, no-store`.
 */
export function handleApiRequest(request: { method: string; path: string }): ApiResponse {
  if (request.path === '/api/health' && request.method === 'GET') {
    return { status: 200, body: { ok: true } };
  }
  const body: ApiError = apiError('not_found', 'APIが見つかりません。');
  return { status: 404, body };
}
