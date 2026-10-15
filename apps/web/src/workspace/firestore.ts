import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { app, usingEmulators } from './firebase.ts';

/** Firestore client, loaded only with the shop pages (keeps the sign-in bundle small). */
export const db = getFirestore(app);
if (usingEmulators) connectFirestoreEmulator(db, '127.0.0.1', 8080);
