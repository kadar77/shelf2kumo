import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { beforeAll, describe, expect, it } from 'vitest';
import { PROJECT_ID, api, createTestUser, type TestUser } from '../support/emulators.ts';

// Admin access to the Firestore emulator for assertions only (bypasses rules).
const db = getFirestore(initializeApp({ projectId: PROJECT_ID }, 'api-tests'));

let ownerA: TestUser;
let ownerB: TestUser;

beforeAll(async () => {
  [ownerA, ownerB] = await Promise.all([createTestUser('owner-a'), createTestUser('owner-b')]);
});

async function createShop(user: TestUser, name = 'テストのお店') {
  const response = await api('POST', '/api/shops', { user, body: { name } });
  expect(response.status).toBe(201);
  return response.body as { shopId: string; slug: string };
}

describe('POST /api/shops (P1-1)', () => {
  it('creates a shop owned by the verified caller with a reserved random slug', async () => {
    const { shopId, slug } = await createShop(ownerA, '器と道具 こもれび');
    expect(slug).toMatch(/^[a-z2-9]{8}$/);

    const shop = (await db.doc(`shops/${shopId}`).get()).data();
    expect(shop).toMatchObject({
      ownerId: ownerA.uid,
      slug,
      slugLocked: false,
      name: '器と道具 こもれび',
      isDemo: false,
      profileRevision: 0,
      contentRevision: 0,
      liveReleaseId: null,
    });
    expect((await db.doc(`slugReservations/${slug}`).get()).data()).toMatchObject({ shopId });
  });

  it('rejects anonymous and invalid-token callers', async () => {
    expect((await api('POST', '/api/shops', { body: { name: 'x' } })).status).toBe(401);
    const forgedToken = { ...ownerA, idToken: 'not-a-real-token' };
    expect((await api('POST', '/api/shops', { user: forgedToken, body: { name: 'x' } })).status).toBe(401);
  });

  it('rejects a body ownerId instead of trusting it (P1-2)', async () => {
    const response = await api('POST', '/api/shops', { user: ownerB, body: { name: '偽装', ownerId: ownerA.uid } });
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ error: { code: 'bad_request' } });
  });

  it('validates input and content type', async () => {
    expect((await api('POST', '/api/shops', { user: ownerA, body: { name: '' } })).status).toBe(400);
    const text = await api('POST', '/api/shops', { user: ownerA, body: 'name=x', headers: { 'Content-Type': 'text/plain' } });
    expect(text.status).toBe(400);
  });
});

describe('PATCH /api/shops/:id', () => {
  it('updates the profile with the expected revision and bumps revisions', async () => {
    const { shopId } = await createShop(ownerA);
    const response = await api('PATCH', `/api/shops/${shopId}`, {
      user: ownerA,
      body: { expectedRevision: 0, changes: { hours: '10:00〜18:00', phone: '03-1234-5678' } },
    });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ profileRevision: 1 });
    expect((await db.doc(`shops/${shopId}`).get()).data()).toMatchObject({
      hours: '10:00〜18:00',
      phone: '03-1234-5678',
      profileRevision: 1,
      contentRevision: 1,
    });
  });

  it('rejects a stale revision with 409 and leaves data unchanged', async () => {
    const { shopId } = await createShop(ownerA);
    await api('PATCH', `/api/shops/${shopId}`, { user: ownerA, body: { expectedRevision: 0, changes: { hours: '朝' } } });
    const stale = await api('PATCH', `/api/shops/${shopId}`, { user: ownerA, body: { expectedRevision: 0, changes: { hours: '夜' } } });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: { code: 'revision_conflict' } });
    expect((await db.doc(`shops/${shopId}`).get()).get('hours')).toBe('朝');
  });

  it("gives another owner a 404 and does not change the shop (P1-1)", async () => {
    const { shopId } = await createShop(ownerA, '元の名前');
    const response = await api('PATCH', `/api/shops/${shopId}`, { user: ownerB, body: { expectedRevision: 0, changes: { name: '乗っ取り' } } });
    expect(response.status).toBe(404);
    expect((await db.doc(`shops/${shopId}`).get()).get('name')).toBe('元の名前');
  });

  it('moves the slug reservation when the slug changes and refuses reserved slugs', async () => {
    const { shopId, slug } = await createShop(ownerA);
    const newSlug = `tea-${Date.now().toString(36)}`;
    const moved = await api('PATCH', `/api/shops/${shopId}`, { user: ownerA, body: { expectedRevision: 0, changes: { slug: newSlug } } });
    expect(moved.status).toBe(200);
    expect((await db.doc(`slugReservations/${newSlug}`).get()).get('shopId')).toBe(shopId);
    expect((await db.doc(`slugReservations/${slug}`).get()).exists).toBe(false);

    const reserved = await api('PATCH', `/api/shops/${shopId}`, { user: ownerA, body: { expectedRevision: 1, changes: { slug: 'demo' } } });
    expect(reserved.status).toBe(409);
    expect(reserved.body).toMatchObject({ error: { code: 'slug_unavailable' } });
  });

  it('refuses slug changes once the slug is locked', async () => {
    const { shopId } = await createShop(ownerA);
    await db.doc(`shops/${shopId}`).update({ slugLocked: true });
    const response = await api('PATCH', `/api/shops/${shopId}`, { user: ownerA, body: { expectedRevision: 0, changes: { slug: 'locked-try' } } });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: { code: 'slug_unavailable' } });
  });
});

describe('concurrent slug claims (P1-3)', () => {
  it('lets exactly one of two shops claim the same slug', async () => {
    const [shopA, shopB] = await Promise.all([createShop(ownerA), createShop(ownerB)]);
    const slug = `race-${Date.now().toString(36)}`;
    const results = await Promise.all([
      api('PATCH', `/api/shops/${shopA.shopId}`, { user: ownerA, body: { expectedRevision: 0, changes: { slug } } }),
      api('PATCH', `/api/shops/${shopB.shopId}`, { user: ownerB, body: { expectedRevision: 0, changes: { slug } } }),
    ]);
    const statuses = results.map((result) => result.status).sort();
    expect(statuses).toEqual([200, 409]);

    const winner = results[0]?.status === 200 ? shopA.shopId : shopB.shopId;
    expect((await db.doc(`slugReservations/${slug}`).get()).get('shopId')).toBe(winner);
  });
});

describe('routing', () => {
  it('returns 404 for unknown routes and 405 for wrong methods', async () => {
    expect((await api('GET', '/api/nope')).status).toBe(404);
    expect((await api('DELETE', '/api/shops', { user: ownerA })).status).toBe(405);
  });
});
