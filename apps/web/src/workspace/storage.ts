import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { app, usingEmulators } from './firebase.ts';

/** Storage client for private uploads and rendition previews, loaded only with the shop pages. */
export const storage = getStorage(app);
if (usingEmulators) connectStorageEmulator(storage, '127.0.0.1', 9199);
