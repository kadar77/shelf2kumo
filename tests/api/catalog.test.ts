import { initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { fixtureExtractor } from '../../functions/src/extraction/fixture.ts';
import { recoverExtractionJobs } from '../../functions/src/extraction/recovery.ts';
import { usageRef } from '../../functions/src/extraction/usage.ts';
import { kickNext, runExtractionJob, type WorkerDeps } from '../../functions/src/extraction/worker.ts';
import type { ObjectStore } from '../../functions/src/images/store.ts';
import { PROJECT_ID, STORAGE_BUCKET, api, createTestUser, type TestUser } from '../support/emulators.ts';

const app = initializeApp({ projectId: PROJECT_ID, storageBucket: STORAGE_BUCKET }, 'catalog-tests');
const db = getFirestore(app);
const bucket = getStorage(app).bucket();

const store: ObjectStore = {
  stat: async () => null,
  read: async (path) => (await bucket.file(path).download())[0],
  write: async () => undefined,
  remove: async () => undefined,
};
const workerDeps = (): WorkerDeps => ({ db, store, extractor: fixtureExtractor(db), sleep: async () => undefined });

let owner: TestUser;
let other: TestUser;
let shopId: string;
let colorSeed = 0;

async function newShop(user: TestUser) {
  const created = await api('POST', '/api/shops', { user, body: { name: 'カタログテスト' } });
  expect(created.status).toBe(201);
  return (created.body as { shopId: string }).shopId;
}

/** Uploads a unique processed photo and returns its image ID and rendition hash. */
async function processedImage(user = owner, shop = shopId): Promise<{ imageId: string; contentHash: string }> {
  colorSeed += 1;
  const allocated = await api('POST', `/api/shops/${shop}/uploads`, { user, body: { contentType: 'image/jpeg', bytes: 20_000 } });
  const { imageId, uploadPath } = allocated.body as { imageId: string; uploadPath: string };
  const photo = await sharp({
    create: { width: 640, height: 480, channels: 3, background: { r: (colorSeed * 37) % 256, g: (colorSeed * 91) % 256, b: Date.now() % 256 } },
  })
    .jpeg()
    .toBuffer();
  await bucket.file(uploadPath).save(photo, { contentType: 'image/jpeg', resumable: false });
  const processed = await api('POST', `/api/shops/${shop}/images/${imageId}/process`, { user, body: {} });
  expect(processed.status).toBe(200);
  return { imageId, contentHash: (processed.body as { contentHash: string }).contentHash };
}

const fixture = (contentHash: string, data: Record<string, unknown>) => db.doc(`emulatorFixtures/${contentHash}`).set(data);

async function startExtraction(imageId: string, user = owner, shop = shopId, extra: Record<string, unknown> = {}) {
  return api('POST', `/api/shops/${shop}/extractions`, { user, body: { imageId, ...extra } });
}

async function waitForJob(jobId: string, shop = shopId, timeoutMs = 25_000): Promise<FirebaseFirestore.DocumentData> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = (await db.doc(`shops/${shop}/jobs/${jobId}`).get()).data();
    if (job && (job.state === 'succeeded' || job.state === 'failed')) return job;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`job ${jobId} did not finish`);
}

beforeAll(async () => {
  [owner, other] = await Promise.all([createTestUser('cat-owner'), createTestUser('cat-other')]);
  shopId = await newShop(owner);
});

describe('photo → item (P3-1)', () => {
  it('creates a saved, unpublished, editable item without any review step', async () => {
    const { imageId } = await processedImage();
    const revisionBefore = (await db.doc(`shops/${shopId}`).get()).get('contentRevision');

    const started = await startExtraction(imageId);
    expect(started.status).toBe(202);
    const { jobId } = started.body as { jobId: string };
    const job = await waitForJob(jobId);

    expect(job).toMatchObject({ state: 'succeeded', outcome: 'item_created', itemId: jobId, model: 'fixture', attempt: 1 });
    const item = (await db.doc(`shops/${shopId}/items/${jobId}`).get()).data();
    expect(item).toMatchObject({
      name: '【フィクスチャ】テスト商品',
      priceJpy: null,
      currency: 'JPY',
      taxTreatment: 'unknown',
      imageId,
      revision: 0,
      sourceJobId: jobId,
      uncertainFields: ['priceJpy'],
    });
    expect(item).not.toHaveProperty('approved');
    expect((await db.doc(`shops/${shopId}`).get()).get('contentRevision')).toBe(revisionBefore + 1);
    expect((await db.doc(`shops/${shopId}`).get()).get('liveReleaseId')).toBeNull();
    expect((await db.doc(`shops/${shopId}/jobs/${jobId}/results/${jobId}`).get()).data()).toMatchObject({ requestedModel: 'fixture' });
  });
});

describe('idempotency and competing workers (P3-2)', () => {
  it('returns the same job for duplicate requests and creates one item', async () => {
    const { imageId } = await processedImage();
    const [a, b] = await Promise.all([startExtraction(imageId), startExtraction(imageId)]);
    expect([a.status, b.status]).toEqual([202, 202]);
    const jobA = (a.body as { jobId: string }).jobId;
    expect((b.body as { jobId: string }).jobId).toBe(jobA);
    expect([a.body, b.body].filter((body) => (body as { duplicate: boolean }).duplicate)).toHaveLength(1);

    await waitForJob(jobA);
    const items = await db.collection(`shops/${shopId}/items`).where('sourceJobId', '==', jobA).get();
    expect(items.size).toBe(1);
  });

  it('lets only one of several concurrent workers call the provider and finalize', async () => {
    const { imageId, contentHash } = await processedImage();
    await fixture(contentHash, { delayMs: 800 });
    const { jobId } = (await startExtraction(imageId)).body as { jobId: string };
    // The emulator trigger is already racing; add two more direct workers.
    const results = await Promise.all([runExtractionJob(workerDeps(), shopId, jobId), runExtractionJob(workerDeps(), shopId, jobId)]);
    const job = await waitForJob(jobId);

    expect(job.state).toBe('succeeded');
    expect(results.filter((result) => result === 'succeeded').length).toBeLessThanOrEqual(1);
    expect((await db.doc(`emulatorFixtures/${contentHash}`).get()).get('calls')).toBe(1);
    expect((await db.collection(`shops/${shopId}/items`).where('sourceJobId', '==', jobId).get()).size).toBe(1);
  });

  it('never recreates an item the owner removed when a job is redelivered', async () => {
    const { imageId } = await processedImage();
    const { jobId } = (await startExtraction(imageId)).body as { jobId: string };
    await waitForJob(jobId);
    expect((await api('DELETE', `/api/shops/${shopId}/items/${jobId}`, { user: owner, body: {} })).status).toBe(200);

    expect(await runExtractionJob(workerDeps(), shopId, jobId)).toBe('not_queued');
    expect((await db.doc(`shops/${shopId}/items/${jobId}`).get()).exists).toBe(false);
    const replay = await startExtraction(imageId);
    expect(replay.body).toMatchObject({ jobId, duplicate: true });
  });
});

describe('leases and quotas (P3-3)', () => {
  it('turns an expired lease into an actionable failure and releases the lock', async () => {
    const ownerId = `lease-owner-${Date.now()}`;
    const jobRef = db.doc(`shops/${shopId}/jobs/expired-${Date.now()}`);
    await db.doc(`extractionLocks/${ownerId}`).set({ jobId: jobRef.id, shopId, leaseExpiresAt: Timestamp.fromMillis(Date.now() - 10 * 60_000) });
    await jobRef.set({
      ownerId,
      imageId: 'x',
      mode: 'single',
      state: 'running',
      leaseToken: 'old-token',
      leaseExpiresAt: Timestamp.fromMillis(Date.now() - 10 * 60_000),
      attempt: 1,
      kick: 0,
      createdAt: Timestamp.fromMillis(Date.now() - 11 * 60_000),
    });

    const result = await recoverExtractionJobs(db);
    expect(result.expired).toBeGreaterThanOrEqual(1);
    const job = (await jobRef.get()).data();
    expect(job).toMatchObject({ state: 'failed', leaseToken: null, error: { code: 'lease_expired', retryable: true } });
    expect(String(job?.error.message)).toContain('もう一度お試しください');
    expect((await db.doc(`extractionLocks/${ownerId}`).get()).exists).toBe(false);
  });

  it('holds the daily allowance under concurrent requests', async () => {
    const quotaOwner = await createTestUser('quota-owner');
    const quotaShop = await newShop(quotaOwner);
    const [first, second] = [await processedImage(quotaOwner, quotaShop), await processedImage(quotaOwner, quotaShop)];
    await usageRef(db, quotaOwner.uid, Date.now()).set({ ownerId: quotaOwner.uid, extractionAttempts: 19 });

    const started = await Promise.all([startExtraction(first.imageId, quotaOwner, quotaShop), startExtraction(second.imageId, quotaOwner, quotaShop)]);
    // Depending on timing the second request is refused by the API pre-check (429) or by the worker's
    // transactional reservation (job failed: quota_exceeded). Either way only one provider call happens.
    const outcomes: string[] = [];
    for (const response of started) {
      if (response.status === 429) {
        expect(response.body).toMatchObject({ error: { code: 'quota_exceeded' } });
        outcomes.push('refused');
      } else {
        const job = await waitForJob((response.body as { jobId: string }).jobId, quotaShop);
        outcomes.push(job.state === 'succeeded' ? 'succeeded' : job.error.code);
      }
    }
    expect(outcomes.filter((outcome) => outcome === 'succeeded')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'refused' || outcome === 'quota_exceeded')).toHaveLength(1);
    expect((await usageRef(db, quotaOwner.uid, Date.now()).get()).get('extractionAttempts')).toBe(20);

    const third = await processedImage(quotaOwner, quotaShop);
    const refused = await startExtraction(third.imageId, quotaOwner, quotaShop);
    expect(refused.status).toBe(429);
  });

  it('refuses the provider call in the worker when the allowance ran out while queued', async () => {
    const lateOwner = await createTestUser('late-quota');
    const lateShop = await newShop(lateOwner);
    const { imageId } = await processedImage(lateOwner, lateShop);
    // Another extraction holds the owner's lock, so the new job waits in the queue.
    await db.doc(`extractionLocks/${lateOwner.uid}`).set({ jobId: 'other-job', shopId: lateShop, leaseExpiresAt: Timestamp.fromMillis(Date.now() + 60_000) });
    const { jobId } = (await startExtraction(imageId, lateOwner, lateShop)).body as { jobId: string };
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect((await db.doc(`shops/${lateShop}/jobs/${jobId}`).get()).get('state')).toBe('queued');

    await usageRef(db, lateOwner.uid, Date.now()).set({ ownerId: lateOwner.uid, extractionAttempts: 20 });
    await db.doc(`extractionLocks/${lateOwner.uid}`).delete();
    await kickNext(db, lateOwner.uid);
    expect(await waitForJob(jobId, lateShop)).toMatchObject({ state: 'failed', attempt: 0, error: { code: 'quota_exceeded', retryable: false } });
  });
});

describe('outcomes and retries', () => {
  it('creates no item for a multi-product photo and records the count (P3-4)', async () => {
    const { imageId, contentHash } = await processedImage();
    await fixture(contentHash, { output: { schemaVersion: 1, items: [], productCountEstimate: 3, warnings: [] } });
    const { jobId } = (await startExtraction(imageId)).body as { jobId: string };
    expect(await waitForJob(jobId)).toMatchObject({ state: 'succeeded', outcome: 'multiple_products', itemId: null, productCountEstimate: 3 });
    expect((await db.doc(`shops/${shopId}/items/${jobId}`).get()).exists).toBe(false);
  });

  it('records nothing_found for empty output', async () => {
    const { imageId, contentHash } = await processedImage();
    await fixture(contentHash, { output: { schemaVersion: 1, items: [], productCountEstimate: 0, warnings: ['ぼやけています'] } });
    const { jobId } = (await startExtraction(imageId)).body as { jobId: string };
    expect(await waitForJob(jobId)).toMatchObject({ outcome: 'nothing_found', itemId: null });
  });

  it('retries a transient failure once and succeeds', async () => {
    const { imageId, contentHash } = await processedImage();
    await fixture(contentHash, { failures: ['timeout'] });
    const { jobId } = (await startExtraction(imageId)).body as { jobId: string };
    expect(await waitForJob(jobId)).toMatchObject({ state: 'succeeded', attempt: 2 });
  });

  it('does not retry authentication errors', async () => {
    const { imageId, contentHash } = await processedImage();
    await fixture(contentHash, { failures: ['http_401', 'http_401'] });
    const { jobId } = (await startExtraction(imageId)).body as { jobId: string };
    expect(await waitForJob(jobId)).toMatchObject({ state: 'failed', attempt: 1, error: { code: 'ai_rejected' } });
  });

  it('stops after two invalid outputs and allows an explicit linked retry', async () => {
    const { imageId, contentHash } = await processedImage();
    await fixture(contentHash, { failures: ['not_json', 'not_json'] });
    const { jobId } = (await startExtraction(imageId)).body as { jobId: string };
    expect(await waitForJob(jobId)).toMatchObject({ state: 'failed', attempt: 2, error: { code: 'ai_invalid_output' } });

    const retry = await startExtraction(imageId, owner, shopId, { retryOfJobId: jobId });
    expect(retry.status).toBe(202);
    const retryId = (retry.body as { jobId: string }).jobId;
    expect(retryId).not.toBe(jobId);
    expect(await waitForJob(retryId)).toMatchObject({ state: 'succeeded', retryOf: jobId });
  });
});

describe('manual catalog editing (P3-5, P3-6)', () => {
  it('supports manual entry with the photo after a failed extraction', async () => {
    const { imageId } = await processedImage();
    const created = await api('POST', `/api/shops/${shopId}/items`, { user: owner, body: { imageId, name: null } });
    expect(created.status).toBe(201);
    const item = (await db.doc(`shops/${shopId}/items/${(created.body as { itemId: string }).itemId}`).get()).data();
    expect(item).toMatchObject({ name: null, imageId, revision: 0, sourceJobId: null });
  });

  it('does not return 409 when an extraction completes while another item is edited', async () => {
    const manual = await api('POST', `/api/shops/${shopId}/items`, { user: owner, body: { name: '手動の商品', priceJpy: 500 } });
    const itemA = (manual.body as { itemId: string }).itemId;
    const { imageId, contentHash } = await processedImage();
    await fixture(contentHash, { delayMs: 1500 });
    const { jobId } = (await startExtraction(imageId)).body as { jobId: string };

    await new Promise((resolve) => setTimeout(resolve, 600));
    const edits = [];
    for (let revision = 0; revision < 3; revision += 1) {
      edits.push(await api('PATCH', `/api/shops/${shopId}/items/${itemA}`, { user: owner, body: { expectedRevision: revision, changes: { priceJpy: 600 + revision } } }));
    }
    expect(edits.map((edit) => edit.status)).toEqual([200, 200, 200]);
    expect(await waitForJob(jobId)).toMatchObject({ state: 'succeeded', outcome: 'item_created' });
    expect((await db.doc(`shops/${shopId}/items/${itemA}`).get()).get('priceJpy')).toBe(602);
  });

  it('enforces item revisions, clears uncertainty on edit, and isolates owners', async () => {
    const { imageId } = await processedImage();
    const { jobId } = (await startExtraction(imageId)).body as { jobId: string };
    await waitForJob(jobId);

    const edited = await api('PATCH', `/api/shops/${shopId}/items/${jobId}`, { user: owner, body: { expectedRevision: 0, changes: { priceJpy: 864, taxTreatment: 'included' } } });
    expect(edited.body).toEqual({ revision: 1 });
    expect((await db.doc(`shops/${shopId}/items/${jobId}`).get()).get('uncertainFields')).toEqual([]);

    const stale = await api('PATCH', `/api/shops/${shopId}/items/${jobId}`, { user: owner, body: { expectedRevision: 0, changes: { priceJpy: 1 } } });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: { code: 'revision_conflict' } });

    expect((await api('PATCH', `/api/shops/${shopId}/items/${jobId}`, { user: other, body: { expectedRevision: 1, changes: { priceJpy: 1 } } })).status).toBe(404);
    expect((await api('DELETE', `/api/shops/${shopId}/items/${jobId}`, { user: other, body: {} })).status).toBe(404);
    expect((await startExtraction(imageId, other)).status).toBe(404);
  });

  it('reorders only with the exact current set of items', async () => {
    const reorderShop = await newShop(owner);
    const ids: string[] = [];
    for (const name of ['一', '二', '三']) {
      ids.push(((await api('POST', `/api/shops/${reorderShop}/items`, { user: owner, body: { name } })).body as { itemId: string }).itemId);
    }
    const reversed = [...ids].reverse();
    expect((await api('POST', `/api/shops/${reorderShop}/items/reorder`, { user: owner, body: { itemIds: reversed } })).status).toBe(200);
    const ordered = await db.collection(`shops/${reorderShop}/items`).orderBy('order').get();
    expect(ordered.docs.map((doc) => doc.id)).toEqual(reversed);

    const partial = await api('POST', `/api/shops/${reorderShop}/items/reorder`, { user: owner, body: { itemIds: reversed.slice(1) } });
    expect(partial.status).toBe(409);
  });
});
