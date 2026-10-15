import { HttpError, type ApiRequest } from './http.ts';

export interface AuthDeps {
  verifyIdToken(token: string): Promise<{ uid: string }>;
  /** Present only when App Check is configured; throws for invalid tokens. */
  verifyAppCheckToken?: (token: string) => Promise<unknown>;
  appCheckEnforced: boolean;
}

/**
 * Verifies the Firebase ID token (and App Check when enforced) and returns the caller's uid.
 * Identity always comes from the verified token, never from the request body.
 */
export async function authenticate(request: ApiRequest, deps: AuthDeps): Promise<string> {
  if (deps.appCheckEnforced) {
    const appCheckToken = request.header('x-firebase-appcheck');
    if (!appCheckToken || !deps.verifyAppCheckToken) throw appCheckFailed();
    try {
      await deps.verifyAppCheckToken(appCheckToken);
    } catch {
      throw appCheckFailed();
    }
  }

  const match = /^Bearer ([A-Za-z0-9._-]+)$/.exec(request.header('authorization') ?? '');
  if (!match?.[1]) throw unauthenticated();
  try {
    const decoded = await deps.verifyIdToken(match[1]);
    return decoded.uid;
  } catch {
    throw unauthenticated();
  }
}

const unauthenticated = () => new HttpError(401, 'unauthenticated', 'ログインが必要です。もう一度ログインしてください。');
const appCheckFailed = () => new HttpError(403, 'forbidden', 'アプリの確認に失敗しました。ページを再読み込みしてください。');
