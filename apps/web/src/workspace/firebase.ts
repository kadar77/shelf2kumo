import { initializeApp } from 'firebase/app';
import { ReCaptchaEnterpriseProvider, getToken, initializeAppCheck, type AppCheck } from 'firebase/app-check';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';

const env = import.meta.env;

/**
 * Emulators are used only when explicitly enabled AND the page is served locally, so a production
 * build can never talk to emulators even if the flag leaks into its environment.
 */
export const usingEmulators =
  env.VITE_USE_EMULATORS === 'true' && ['localhost', '127.0.0.1'].includes(globalThis.location?.hostname ?? '');

/** Emulators run the offline demo project; its ID must match for Auth tokens and Firestore data. */
const EMULATOR_PROJECT_ID = 'demo-shelf2kumo';

const app = initializeApp({
  apiKey: usingEmulators ? 'fake-api-key' : env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: usingEmulators ? EMULATOR_PROJECT_ID : env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  appId: env.VITE_FIREBASE_APP_ID,
});

export const auth = getAuth(app);
auth.languageCode = 'ja';
export const db = getFirestore(app);

if (usingEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
}

/** App Check is active once a reCAPTCHA Enterprise site key is configured (spec §5). */
const appCheck: AppCheck | null =
  !usingEmulators && env.VITE_APP_CHECK_SITE_KEY
    ? initializeAppCheck(app, {
        provider: new ReCaptchaEnterpriseProvider(env.VITE_APP_CHECK_SITE_KEY),
        isTokenAutoRefreshEnabled: true,
      })
    : null;

export async function appCheckToken(): Promise<string | null> {
  if (!appCheck) return null;
  try {
    return (await getToken(appCheck, false)).token;
  } catch {
    return null;
  }
}
