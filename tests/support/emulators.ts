/** Emulator endpoints; `firebase emulators:exec` sets the host variables for the child process. */
export const PROJECT_ID = process.env.GCLOUD_PROJECT ?? 'demo-shelf2kumo';
export const FIRESTORE_HOST = process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080';
export const AUTH_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
/** API calls go through the Hosting emulator so the /api rewrite is exercised too. */
export const HOSTING_ORIGIN = process.env.HOSTING_ORIGIN ?? 'http://127.0.0.1:5050';

if (!PROJECT_ID.startsWith('demo-')) throw new Error(`Emulator tests must use a demo-* project, got ${PROJECT_ID}`);

export interface TestUser {
  uid: string;
  idToken: string;
  email: string;
}

let counter = 0;

/** Creates a user in the Auth emulator and returns a real (emulator-signed) ID token. */
export async function createTestUser(label: string): Promise<TestUser> {
  counter += 1;
  const email = `${label}-${Date.now()}-${counter}@example.test`;
  const response = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'test-password-123', returnSecureToken: true }),
  });
  if (!response.ok) throw new Error(`Auth emulator signUp failed: ${response.status}`);
  const body = (await response.json()) as { localId: string; idToken: string };
  return { uid: body.localId, idToken: body.idToken, email };
}

export async function api(
  method: string,
  path: string,
  options: { user?: TestUser; body?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.body !== undefined) headers['Content-Type'] ??= 'application/json';
  if (options.user) headers.Authorization = `Bearer ${options.user.idToken}`;
  const response = await fetch(`${HOSTING_ORIGIN}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : typeof options.body === 'string' ? options.body : JSON.stringify(options.body),
  });
  const text = await response.text();
  try {
    return { status: response.status, body: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { status: response.status, body: { raw: text } };
  }
}
