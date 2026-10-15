import { initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import { HOSTING_ORIGIN, PROJECT_ID, STORAGE_BUCKET, api, createTestUser, type TestUser } from '../support/emulators.ts';

const app = initializeApp({ projectId: PROJECT_ID, storageBucket: STORAGE_BUCKET }, 'publish-tests');
const db = getFirestore(app);
const bucket = getStorage(app).bucket();

let owner: TestUser;
beforeEach(async () => {
  owner = await createTestUser('pub-owner');
});

async function newShop(user = owner, name = '公開テストのお店') {
  const created = await api('POST', '/api/shops', { user, body: { name } });
  return created.body as { shopId: string; slug: string };
}

async function addItem(shopId: string, body: Record<string, unknown>, user = owner) {
  const created = await api('POST', `/api/shops/${shopId}/items`, { user, body });
  expect(created.status).toBe(201);
  return (created.body as { itemId: string }).itemId;
}

async function processedImage(shopId: string, user = owner) {
  const allocated = await api('POST', `/api/shops/${shopId}/uploads`, { user, body: { contentType: 'image/jpeg', bytes: 10_000 } });
  const { imageId, uploadPath } = allocated.body as { imageId: string; uploadPath: string };
  const photo = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 90, g: 60, b: Date.now() % 256 } } }).jpeg().toBuffer();
  await bucket.file(uploadPath).save(photo, { contentType: 'image/jpeg', resumable: false });
  const processed = await api('POST', `/api/shops/${shopId}/images/${imageId}/process`, { user, body: {} });
  return { imageId, contentHash: (processed.body as { contentHash: string }).contentHash };
}

const prepare = (shopId: string, user = owner) => api('POST', `/api/shops/${shopId}/prepare-publication`, { user, body: {} });

/** The publish request carries only the confirmation ID and hash (strict contract). */
const confirmationOf = (body: Record<string, unknown>) => ({ confirmationId: body.confirmationId as string, snapshotHash: body.snapshotHash as string });

async function publish(shopId: string, user = owner) {
  const prepared = await prepare(shopId, user);
  expect(prepared.status).toBe(200);
  const { confirmationId, snapshotHash } = prepared.body as { confirmationId: string; snapshotHash: string };
  const published = await api('POST', `/api/shops/${shopId}/publish`, { user, body: { confirmationId, snapshotHash } });
  expect(published.status).toBe(200);
  return { prepared: prepared.body, published: published.body as { releaseId: string; url: string } };
}

async function fetchPublic(path: string) {
  const response = await fetch(`${HOSTING_ORIGIN}${path}`);
  const body = response.headers.get('content-type')?.startsWith('image/') ? '' : await response.text();
  return { status: response.status, headers: response.headers, body };
}

describe('publish with one confirmation (P5-1, P5-2)', () => {
  it('publishes a photo item and the profile as server-rendered HTML', async () => {
    const { shopId, slug } = await newShop();
    const { imageId, contentHash } = await processedImage(shopId);
    await addItem(shopId, { name: 'ほうじ茶', priceJpy: 864, taxTreatment: 'included', imageId });
    await addItem(shopId, { name: '粉引の飯碗', priceJpy: null });

    const { prepared, published } = await publish(shopId);
    expect(prepared).toMatchObject({ summary: { firstPublication: true, itemCount: 2, added: ['ほうじ茶', '粉引の飯碗'] } });
    expect(published.url).toBe(`http://127.0.0.1:5050/s/${slug}`);

    const page = await fetchPublic(`/s/${slug}`);
    expect(page.status).toBe(200);
    expect(page.body).toContain('ほうじ茶');
    expect(page.body).toContain('864円（税込）');
    expect(page.body).toContain('価格はお問い合わせください');
    expect(page.body).toContain(`/media/${slug}/${contentHash}.jpg`);
    expect(page.body).not.toContain('<script');
    expect(page.headers.get('cache-control')).toBe('public, max-age=0, s-maxage=60');

    const media = await fetchPublic(`/media/${slug}/${contentHash}.jpg`);
    expect(media.status).toBe(200);
    expect(media.headers.get('content-type')).toBe('image/jpeg');

    const shop = (await db.doc(`shops/${shopId}`).get()).data();
    expect(shop).toMatchObject({ slugLocked: true, liveReleaseId: published.releaseId, publishedRevision: shop?.contentRevision });
    expect((await db.doc(`publishedCatalogs/${slug}`).get()).data()).toMatchObject({ shopId, releaseId: published.releaseId, isDemo: false });
  });

  it('keeps draft edits private until the next publication and summarizes them', async () => {
    const { shopId, slug } = await newShop();
    const itemId = await addItem(shopId, { name: 'ほうじ茶', priceJpy: 864 });
    await publish(shopId);
    await api('PATCH', `/api/shops/${shopId}/items/${itemId}`, { user: owner, body: { expectedRevision: 0, changes: { priceJpy: 800 } } });
    await addItem(shopId, { name: '新商品', priceJpy: 500 });

    expect((await fetchPublic(`/s/${slug}`)).body).toContain('864円');
    expect((await fetchPublic(`/s/${slug}`)).body).not.toContain('新商品');

    const prepared = await prepare(shopId);
    expect(prepared.body).toMatchObject({ summary: { firstPublication: false, added: ['新商品'], changed: [{ name: 'ほうじ茶', fields: ['priceJpy'] }] } });
    const { confirmationId, snapshotHash } = prepared.body as { confirmationId: string; snapshotHash: string };
    await api('POST', `/api/shops/${shopId}/publish`, { user: owner, body: { confirmationId, snapshotHash } });
    const page = await fetchPublic(`/s/${slug}`);
    expect(page.body).toContain('800円');
    expect(page.body).toContain('新商品');
  });

  it('reveals no owner IDs, storage paths or AI metadata', async () => {
    const { shopId, slug } = await newShop();
    const { imageId } = await processedImage(shopId);
    const itemId = await addItem(shopId, { name: '写真の商品', imageId });
    await publish(shopId);
    const page = await fetchPublic(`/s/${slug}`);
    const product = await fetchPublic(`/s/${slug}/p/${itemId}`);
    for (const html of [page.body, product.body]) {
      expect(html).not.toContain(owner.uid);
      expect(html).not.toContain('owners/');
      expect(html).not.toContain('renditions');
      expect(html).not.toContain(shopId);
      expect(html).not.toContain('sourceJobId');
      expect(html).not.toContain('uncertainFields');
    }
  });
});

describe('confirmation rules (P5-3)', () => {
  it('rejects stale, reused, expired and mismatched confirmations', async () => {
    const { shopId } = await newShop();
    const itemId = await addItem(shopId, { name: 'ほうじ茶', priceJpy: 864 });

    const first = confirmationOf((await prepare(shopId)).body);
    await api('PATCH', `/api/shops/${shopId}/items/${itemId}`, { user: owner, body: { expectedRevision: 0, changes: { priceJpy: 900 } } });
    const stale = await api('POST', `/api/shops/${shopId}/publish`, { user: owner, body: first });
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ error: { code: 'revision_conflict' } });

    const second = confirmationOf((await prepare(shopId)).body);
    const wrongHash = await api('POST', `/api/shops/${shopId}/publish`, { user: owner, body: { ...second, snapshotHash: 'f'.repeat(64) } });
    expect(wrongHash.status).toBe(409);
    expect((await api('POST', `/api/shops/${shopId}/publish`, { user: owner, body: second })).status).toBe(200);
    const reused = await api('POST', `/api/shops/${shopId}/publish`, { user: owner, body: second });
    expect(reused.status).toBe(409);

    const third = confirmationOf((await prepare(shopId)).body);
    await db.doc(`shops/${shopId}/publishConfirmations/${third.confirmationId}`).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    const expired = await api('POST', `/api/shops/${shopId}/publish`, { user: owner, body: third });
    expect(expired.status).toBe(409);
    expect(expired.body).toMatchObject({ error: { message: expect.stringContaining('有効期限') } });
  });

  it('refuses to prepare while extraction runs or items lack names', async () => {
    const { shopId } = await newShop();
    await db.doc(`shops/${shopId}/jobs/running-job`).set({ ownerId: owner.uid, state: 'running', imageId: 'x', createdAt: Timestamp.now() });
    const running = await prepare(shopId);
    expect(running.status).toBe(409);
    expect(running.body).toMatchObject({ error: { message: expect.stringContaining('読み取りが終わるまで') } });
    await db.doc(`shops/${shopId}/jobs/running-job`).update({ state: 'succeeded' });

    await addItem(shopId, { name: null });
    const unnamed = await prepare(shopId);
    expect(unnamed.status).toBe(409);
    expect(unnamed.body).toMatchObject({ error: { message: expect.stringContaining('商品名が未入力') } });
  });

  it('refuses other owners and locks the slug after publication', async () => {
    const { shopId } = await newShop();
    await publish(shopId);
    const other = await createTestUser('pub-other');
    expect((await prepare(shopId, other)).status).toBe(404);
    expect((await api('POST', `/api/shops/${shopId}/unpublish`, { user: other, body: {} })).status).toBe(404);
    const slugChange = await api('PATCH', `/api/shops/${shopId}`, { user: owner, body: { expectedRevision: 0, changes: { slug: 'new-slug-after' } } });
    expect(slugChange.status).toBe(409);
  });
});

describe('unpublish, isolation and media (P5-4 – P5-8)', () => {
  it('removes pages and media immediately at the origin and is idempotent', async () => {
    const { shopId, slug } = await newShop();
    const { imageId, contentHash } = await processedImage(shopId);
    const itemId = await addItem(shopId, { name: '写真の商品', imageId });
    await publish(shopId);
    expect((await fetchPublic(`/s/${slug}/p/${itemId}`)).status).toBe(200);

    expect((await api('POST', `/api/shops/${shopId}/unpublish`, { user: owner, body: {} })).status).toBe(200);
    expect((await fetchPublic(`/s/${slug}`)).status).toBe(404);
    expect((await fetchPublic(`/s/${slug}/p/${itemId}`)).status).toBe(404);
    expect((await fetchPublic(`/media/${slug}/${contentHash}.jpg`)).status).toBe(404);
    expect((await api('POST', `/api/shops/${shopId}/unpublish`, { user: owner, body: {} })).status).toBe(200);
    expect((await db.doc(`shops/${shopId}`).get()).get('liveReleaseId')).toBeNull();
    expect((await fetchPublic('/s/unknown-shop-xyz')).status).toBe(404);
  });

  it('escapes malicious strings and sends a CSP header (P5-5)', async () => {
    const { shopId, slug } = await newShop(owner, '<img src=x onerror=alert(1)>');
    await addItem(shopId, { name: '<script>alert("xss")</script>', description: '"><svg onload=alert(2)>' });
    await publish(shopId);
    const page = await fetchPublic(`/s/${slug}`);
    expect(page.body).not.toContain('<script>alert');
    expect(page.body).not.toContain('<img src=x');
    expect(page.body).toContain('&lt;script&gt;');
    expect(page.headers.get('content-security-policy')).toContain("default-src 'none'");
  });

  it('keeps shop B live when shop A is published or unpublished (P5-6)', async () => {
    const a = await newShop(owner, 'A のお店');
    const otherOwner = await createTestUser('pub-b');
    const b = await newShop(otherOwner, 'B のお店');
    await addItem(a.shopId, { name: 'A の商品' });
    await addItem(b.shopId, { name: 'B の商品' }, otherOwner);
    await publish(a.shopId);
    await publish(b.shopId, otherOwner);
    await api('POST', `/api/shops/${a.shopId}/unpublish`, { user: owner, body: {} });
    expect((await fetchPublic(`/s/${a.slug}`)).status).toBe(404);
    const pageB = await fetchPublic(`/s/${b.slug}`);
    expect(pageB.status).toBe(200);
    expect(pageB.body).toContain('B の商品');
  });

  it('serves only media referenced by the live release (P5-7)', async () => {
    const { shopId, slug } = await newShop();
    const published = await processedImage(shopId);
    await addItem(shopId, { name: '公開済みの写真', imageId: published.imageId });
    await publish(shopId);
    const draftOnly = await processedImage(shopId);
    await addItem(shopId, { name: '下書きの写真', imageId: draftOnly.imageId });

    expect((await fetchPublic(`/media/${slug}/${published.contentHash}.jpg`)).status).toBe(200);
    expect((await fetchPublic(`/media/${slug}/${draftOnly.contentHash}.jpg`)).status).toBe(404);
    expect((await fetchPublic(`/media/${slug}/${'0'.repeat(64)}.jpg`)).status).toBe(404);
  });

  it('lists only live non-demo catalogs in the sitemap (P5-8)', async () => {
    const live = await newShop(owner, '公開中');
    const gone = await newShop(owner, '停止');
    await publish(live.shopId);
    await publish(gone.shopId);
    await api('POST', `/api/shops/${gone.shopId}/unpublish`, { user: owner, body: {} });
    const sitemap = await fetchPublic('/sitemap.xml');
    expect(sitemap.status).toBe(200);
    expect(sitemap.body).toContain(`/s/${live.slug}</loc>`);
    expect(sitemap.body).not.toContain(`/s/${gone.slug}</loc>`);
  });
});
