import { initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { cleanupAbandonedUploads } from '../../functions/src/images/cleanup.ts';
import type { ObjectStore } from '../../functions/src/images/store.ts';
import { PROJECT_ID, STORAGE_BUCKET, api, createTestUser, type TestUser } from '../support/emulators.ts';

const app = initializeApp({ projectId: PROJECT_ID, storageBucket: STORAGE_BUCKET }, 'images-tests');
const db = getFirestore(app);
const bucket = getStorage(app).bucket();

let owner: TestUser;
let other: TestUser;
let shopId: string;

beforeAll(async () => {
  [owner, other] = await Promise.all([createTestUser('img-owner'), createTestUser('img-other')]);
  const created = await api('POST', '/api/shops', { user: owner, body: { name: '写真テストのお店' } });
  shopId = (created.body as { shopId: string }).shopId;
});

async function allocate(user = owner, body: Record<string, unknown> = { contentType: 'image/jpeg', bytes: 50_000 }) {
  return api('POST', `/api/shops/${shopId}/uploads`, { user, body });
}

async function allocated(): Promise<{ imageId: string; uploadPath: string }> {
  const response = await allocate();
  expect(response.status).toBe(201);
  return response.body as { imageId: string; uploadPath: string };
}

const processImage = (imageId: string, user = owner) => api('POST', `/api/shops/${shopId}/images/${imageId}/process`, { user, body: {} });

/** Simulates the browser upload (Storage rules are covered by the rules suite). */
const upload = (path: string, data: Buffer, contentType = 'image/jpeg') => bucket.file(path).save(data, { contentType, resumable: false });

describe('upload allocation', () => {
  it('allocates a private owner-scoped path and records the image', async () => {
    const { imageId, uploadPath } = await allocated();
    expect(uploadPath).toBe(`owners/${owner.uid}/shops/${shopId}/uploads/${imageId}`);
    expect((await db.doc(`shops/${shopId}/images/${imageId}`).get()).data()).toMatchObject({
      ownerId: owner.uid,
      state: 'allocated',
      uploadPath,
      claimedContentType: 'image/jpeg',
    });
  });

  it("refuses another owner's shop and invalid requests", async () => {
    expect((await allocate(other)).status).toBe(404);
    expect((await allocate(owner, { contentType: 'image/heic', bytes: 10 })).status).toBe(400);
    expect((await allocate(owner, { contentType: 'image/jpeg', bytes: 8 * 1024 * 1024 + 1 })).status).toBe(400);
    expect((await api('POST', `/api/shops/${shopId}/uploads`, { body: { contentType: 'image/jpeg', bytes: 10 } })).status).toBe(401);
  });
});

describe('processing (P2-1, P2-2)', () => {
  it('creates an EXIF-free 1600px rendition and is idempotent', async () => {
    const { imageId, uploadPath } = await allocated();
    const photo = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#8a6a4a' } })
      .withExif({ IFD0: { Copyright: 'owner-secret' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 0/1 0/1' } })
      .jpeg()
      .toBuffer();
    await upload(uploadPath, photo);

    const first = await processImage(imageId);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ imageId, state: 'processed', width: 1600, height: 1067 });

    const doc = (await db.doc(`shops/${shopId}/images/${imageId}`).get()).data();
    expect(doc).toMatchObject({ state: 'processed', renditionPath: `owners/${owner.uid}/shops/${shopId}/renditions/${imageId}.jpg` });

    const [rendition] = await bucket.file(doc?.renditionPath as string).download();
    const metadata = await sharp(rendition).metadata();
    expect(metadata.exif).toBeUndefined();
    expect(rendition.includes(Buffer.from('owner-secret'))).toBe(false);
    expect(doc?.contentHash).toBe(createHash('sha256').update(rendition).digest('hex'));

    const again = await processImage(imageId);
    expect(again.body).toEqual(first.body);
  });

  it('keeps the allocation when nothing was uploaded yet', async () => {
    const { imageId } = await allocated();
    const response = await processImage(imageId);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'image_rejected' } });
    expect((await db.doc(`shops/${shopId}/images/${imageId}`).get()).get('state')).toBe('allocated');
  });

  it('rejects disguised non-images with Japanese guidance and deletes the original', async () => {
    const { imageId, uploadPath } = await allocated();
    await upload(uploadPath, Buffer.from('<script>alert(1)</script>'), 'image/jpeg');
    const response = await processImage(imageId);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'image_rejected', message: expect.stringContaining('JPEG・PNG・WebP') } });
    expect((await db.doc(`shops/${shopId}/images/${imageId}`).get()).data()).toMatchObject({ state: 'rejected', rejectReason: 'unsupported_format' });
    expect((await bucket.file(uploadPath).exists())[0]).toBe(false);
  });

  it('rejects images over 20 megapixels', async () => {
    const { imageId, uploadPath } = await allocated();
    const huge = await sharp({ create: { width: 5000, height: 4200, channels: 3, background: '#ffffff' } }).png().toBuffer();
    await upload(uploadPath, huge, 'image/png');
    const response = await processImage(imageId);
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { message: expect.stringContaining('解像度') } });
  });

  it("gives another owner a 404 for someone else's image", async () => {
    const { imageId } = await allocated();
    expect((await processImage(imageId, other)).status).toBe(404);
  });
});

describe('cleanup of abandoned uploads', () => {
  it('removes stale allocations and rejected uploads but keeps recent and processed images', async () => {
    const store: ObjectStore = {
      stat: async () => null,
      read: async () => Buffer.alloc(0),
      write: async () => undefined,
      remove: async (path) => {
        await bucket.file(path).delete({ ignoreNotFound: true });
      },
    };
    const images = db.collection(`shops/${shopId}/images`);
    const old = Timestamp.fromMillis(Date.now() - 25 * 60 * 60 * 1000);
    const staleUpload = `owners/${owner.uid}/shops/${shopId}/uploads/stale`;
    await upload(staleUpload, Buffer.from('partial'));
    await images.doc('stale').set({ ownerId: owner.uid, state: 'allocated', uploadPath: staleUpload, createdAt: old });
    await images.doc('staleRejected').set({ ownerId: owner.uid, state: 'rejected', uploadPath: 'x/none', createdAt: old });
    await images.doc('oldProcessed').set({ ownerId: owner.uid, state: 'processed', uploadPath: 'x/kept', createdAt: old });
    await images.doc('fresh').set({ ownerId: owner.uid, state: 'allocated', uploadPath: 'x/fresh', createdAt: Timestamp.now() });

    const removed = await cleanupAbandonedUploads(db, store);
    expect(removed).toBeGreaterThanOrEqual(2);
    expect((await images.doc('stale').get()).exists).toBe(false);
    expect((await images.doc('staleRejected').get()).exists).toBe(false);
    expect((await images.doc('oldProcessed').get()).exists).toBe(true);
    expect((await images.doc('fresh').get()).exists).toBe(true);
    expect((await bucket.file(staleUpload).exists())[0]).toBe(false);
  });
});
