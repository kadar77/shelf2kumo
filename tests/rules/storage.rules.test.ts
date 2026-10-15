import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { getBytes, listAll, ref, uploadBytes } from 'firebase/storage';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { FIRESTORE_HOST, PROJECT_ID, STORAGE_BUCKET, STORAGE_HOST } from '../support/emulators.ts';

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const [fsHost, fsPort] = FIRESTORE_HOST.split(':') as [string, string];
const [stHost, stPort] = STORAGE_HOST.split(':') as [string, string];

let env: RulesTestEnvironment;
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
const uploadPath = (uid: string, shopId: string, imageId: string) => `owners/${uid}/shops/${shopId}/uploads/${imageId}`;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: read('../../firestore.rules'), host: fsHost, port: Number(fsPort) },
    storage: { rules: read('../../storage.rules'), host: stHost, port: Number(stPort) },
  });
});

afterAll(async () => {
  await env.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.clearStorage();
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'shops/shopA'), { ownerId: 'ownerA' });
    await setDoc(doc(db, 'shops/shopA/images/img1'), { ownerId: 'ownerA', state: 'allocated', uploadPath: uploadPath('ownerA', 'shopA', 'img1') });
    await setDoc(doc(db, 'shops/shopA/images/img2'), { ownerId: 'ownerA', state: 'allocated', uploadPath: uploadPath('ownerA', 'shopA', 'img2') });
    await setDoc(doc(db, 'shops/shopA/images/done'), { ownerId: 'ownerA', state: 'processed', uploadPath: uploadPath('ownerA', 'shopA', 'done') });
    const storage = context.storage(STORAGE_BUCKET);
    await uploadBytes(ref(storage, 'owners/ownerA/shops/shopA/renditions/done.jpg'), jpeg, { contentType: 'image/jpeg' });
    await uploadBytes(ref(storage, uploadPath('ownerA', 'shopA', 'done')), jpeg, { contentType: 'image/jpeg' });
  });
});

const storageAs = (uid: string | null) => (uid ? env.authenticatedContext(uid) : env.unauthenticatedContext()).storage(STORAGE_BUCKET);
const put = (uid: string | null, path: string, data: Uint8Array = jpeg, contentType = 'image/jpeg') =>
  uploadBytes(ref(storageAs(uid), path), data, { contentType });

describe('uploads (P2-1, P2-2)', () => {
  it('lets the owner upload once to an allocated path', async () => {
    await assertSucceeds(put('ownerA', uploadPath('ownerA', 'shopA', 'img1')));
    await assertFails(put('ownerA', uploadPath('ownerA', 'shopA', 'img1')));
  });

  it('refuses unallocated, processed, or mismatched paths', async () => {
    await assertFails(put('ownerA', uploadPath('ownerA', 'shopA', 'never-allocated')));
    await assertFails(put('ownerA', uploadPath('ownerA', 'shopA', 'done')));
    await assertFails(put('ownerA', uploadPath('ownerA', 'shopB', 'img1')));
  });

  it('refuses other owners and anonymous users', async () => {
    await assertFails(put('ownerB', uploadPath('ownerA', 'shopA', 'img2')));
    await assertFails(put('ownerB', uploadPath('ownerB', 'shopA', 'img2')));
    await assertFails(put(null, uploadPath('ownerA', 'shopA', 'img2')));
  });

  it('refuses non-image types and files over 8 MiB', async () => {
    await assertFails(put('ownerA', uploadPath('ownerA', 'shopA', 'img2'), jpeg, 'text/html'));
    await assertFails(put('ownerA', uploadPath('ownerA', 'shopA', 'img2'), jpeg, 'image/gif'));
    await assertFails(put('ownerA', uploadPath('ownerA', 'shopA', 'img2'), new Uint8Array(8 * 1024 * 1024 + 1)));
  });
});

describe('reads (P2-2)', () => {
  it('lets only the owner fetch renditions', async () => {
    const rendition = 'owners/ownerA/shops/shopA/renditions/done.jpg';
    await assertSucceeds(getBytes(ref(storageAs('ownerA'), rendition)));
    await assertFails(getBytes(ref(storageAs('ownerB'), rendition)));
    await assertFails(getBytes(ref(storageAs(null), rendition)));
  });

  it('never lets clients read originals or list folders', async () => {
    await assertFails(getBytes(ref(storageAs('ownerA'), uploadPath('ownerA', 'shopA', 'done'))));
    await assertFails(listAll(ref(storageAs('ownerA'), 'owners/ownerA/shops/shopA/renditions')));
  });
});
