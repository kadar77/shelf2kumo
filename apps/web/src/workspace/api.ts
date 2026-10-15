import { ApiError, type ApiErrorCode } from '@shelf2kumo/contracts';
import { appCheckToken, auth } from './firebase.ts';

/** A failed /api call with the server's safe Japanese message. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

const NETWORK_MESSAGE = '通信できませんでした。接続を確認して、もう一度お試しください。';

/** Calls a same-origin /api command with the signed-in user's ID token (and App Check when enabled). */
export async function apiFetch<T>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body: unknown): Promise<T> {
  const user = auth.currentUser;
  if (!user) throw new ApiRequestError(401, 'unauthenticated', 'ログインが必要です。', false);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${await user.getIdToken()}`,
  };
  const appCheck = await appCheckToken();
  if (appCheck) headers['X-Firebase-AppCheck'] = appCheck;

  let response: Response;
  try {
    response = await fetch(path, { method, headers, body: JSON.stringify(body) });
  } catch {
    throw new ApiRequestError(0, 'internal', NETWORK_MESSAGE, true);
  }

  const json: unknown = await response.json().catch(() => null);
  if (response.ok) return json as T;

  const parsed = ApiError.safeParse(json);
  if (parsed.success) {
    const { code, message, retryable } = parsed.data.error;
    throw new ApiRequestError(response.status, code, message, retryable);
  }
  throw new ApiRequestError(response.status, 'internal', 'エラーが発生しました。時間をおいて再度お試しください。', true);
}
