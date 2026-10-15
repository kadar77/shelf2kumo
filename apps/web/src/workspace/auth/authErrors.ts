/** Japanese messages for Firebase Auth error codes; unknown codes get a generic next step. */
const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'メールアドレスまたはパスワードが正しくありません。',
  'auth/invalid-login-credentials': 'メールアドレスまたはパスワードが正しくありません。',
  'auth/wrong-password': 'メールアドレスまたはパスワードが正しくありません。',
  'auth/user-not-found': 'メールアドレスまたはパスワードが正しくありません。',
  'auth/invalid-email': 'メールアドレスの形式が正しくありません。',
  'auth/missing-password': 'パスワードを入力してください。',
  'auth/email-already-in-use': 'このメールアドレスはすでに登録されています。ログインしてください。',
  'auth/weak-password': 'パスワードは 8 文字以上にしてください。',
  'auth/password-does-not-meet-requirements': 'パスワードの条件を満たしていません。8 文字以上にしてください。',
  'auth/too-many-requests': '試行回数が多すぎます。しばらく待ってから再度お試しください。',
  'auth/network-request-failed': '通信できませんでした。接続を確認して、もう一度お試しください。',
  'auth/user-disabled': 'このアカウントは利用できません。',
};

export function authErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String((error as { code: unknown }).code) : '';
  return MESSAGES[code] ?? 'エラーが発生しました。時間をおいて再度お試しください。';
}

export const MIN_PASSWORD_LENGTH = 8;
