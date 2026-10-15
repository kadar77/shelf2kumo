import { describe, expect, it, vi } from 'vitest';
import { createApiHandler, type ApiDeps } from '../src/api/handler.ts';
import type { ApiRequest } from '../src/api/http.ts';
import type { ExtractionJobService } from '../src/extraction/jobs.ts';
import type { ImageService } from '../src/images/service.ts';
import type { ItemService } from '../src/items/service.ts';
import type { ShopService } from '../src/shops/service.ts';
import { isClaimableSlug, randomSlug } from '../src/shops/slug.ts';

function request(overrides: Partial<ApiRequest> & { headers?: Record<string, string> } = {}): ApiRequest {
  const headers = Object.fromEntries(
    Object.entries({ 'content-type': 'application/json', authorization: 'Bearer good-token', ...overrides.headers }).map(([k, v]) => [
      k.toLowerCase(),
      v,
    ]),
  );
  return {
    method: 'POST',
    path: '/api/shops',
    body: { name: 'お店' },
    rawBodyBytes: 20,
    header: (name) => headers[name.toLowerCase()],
    ...overrides,
  };
}

function setup(overrides: Partial<ApiDeps> = {}) {
  const shops: ShopService = {
    create: vi.fn(async () => ({ shopId: 'shop1', slug: 'abcd2345' })),
    update: vi.fn(async () => ({ profileRevision: 1, slug: 'abcd2345' })),
  };
  const images: ImageService = {
    allocate: vi.fn(async () => ({ imageId: 'img1', uploadPath: 'owners/uid-a/shops/shop1/uploads/img1' })),
    process: vi.fn(async () => ({ imageId: 'img1', state: 'processed' as const, width: 1600, height: 1200, contentHash: 'a'.repeat(64) })),
  };
  const items: ItemService = {
    create: vi.fn(async () => ({ itemId: 'item1' })),
    update: vi.fn(async () => ({ revision: 1 })),
    remove: vi.fn(async () => undefined),
    reorder: vi.fn(async () => undefined),
  };
  const extractions: ExtractionJobService = {
    create: vi.fn(async () => ({ jobId: 'job1', state: 'queued' as const, duplicate: false })),
  };
  const deps: ApiDeps = {
    shops,
    images,
    items,
    extractions,
    verifyIdToken: vi.fn(async (token: string) => {
      if (token !== 'good-token') throw new Error('invalid');
      return { uid: 'uid-a' };
    }),
    appCheckEnforced: false,
    ...overrides,
  };
  return { handler: createApiHandler(deps), shops, images, items, extractions, deps };
}

describe('createApiHandler', () => {
  it('serves health without authentication', async () => {
    const { handler } = setup();
    expect(await handler(request({ method: 'GET', path: '/api/health', header: () => undefined }))).toEqual({
      status: 200,
      body: { ok: true },
    });
  });

  it('passes the verified uid, never a body field, to the service', async () => {
    const { handler, shops } = setup();
    const response = await handler(request());
    expect(response.status).toBe(201);
    expect(shops.create).toHaveBeenCalledWith('uid-a', { name: 'お店' });
  });

  it('rejects missing or invalid tokens with 401 before calling the service', async () => {
    const { handler, shops } = setup();
    for (const authorization of ['', 'Bearer bad-token', 'Basic abc']) {
      const response = await handler(request({ headers: { authorization } }));
      expect(response.status, authorization).toBe(401);
      expect(response.body).toMatchObject({ error: { code: 'unauthenticated', retryable: false } });
    }
    expect(shops.create).not.toHaveBeenCalled();
  });

  it('rejects unknown body fields such as ownerId', async () => {
    const { handler, shops } = setup();
    const response = await handler(request({ body: { name: 'お店', ownerId: 'someone-else' } }));
    expect(response.status).toBe(400);
    expect(shops.create).not.toHaveBeenCalled();
  });

  it('enforces content type and body size limits', async () => {
    const { handler } = setup();
    expect((await handler(request({ headers: { 'content-type': 'text/plain' } }))).status).toBe(400);
    expect((await handler(request({ rawBodyBytes: 64 * 1024 + 1 }))).status).toBe(413);
  });

  it('routes PATCH with the shop id and validates the update contract', async () => {
    const { handler, shops } = setup();
    const ok = await handler(request({ method: 'PATCH', path: '/api/shops/shop1', body: { expectedRevision: 0, changes: { hours: '10時〜' } } }));
    expect(ok.status).toBe(200);
    expect(shops.update).toHaveBeenCalledWith('uid-a', 'shop1', { expectedRevision: 0, changes: { hours: '10時〜' } });

    const empty = await handler(request({ method: 'PATCH', path: '/api/shops/shop1', body: { expectedRevision: 0, changes: {} } }));
    expect(empty.status).toBe(400);
  });

  it('routes upload allocation and processing with validated input', async () => {
    const { handler, images } = setup();
    const allocated = await handler(request({ path: '/api/shops/shop1/uploads', body: { contentType: 'image/jpeg', bytes: 1024 } }));
    expect(allocated.status).toBe(201);
    expect(images.allocate).toHaveBeenCalledWith('uid-a', 'shop1', { contentType: 'image/jpeg', bytes: 1024 });

    const gif = await handler(request({ path: '/api/shops/shop1/uploads', body: { contentType: 'image/gif', bytes: 1024 } }));
    const huge = await handler(request({ path: '/api/shops/shop1/uploads', body: { contentType: 'image/jpeg', bytes: 8 * 1024 * 1024 + 1 } }));
    expect([gif.status, huge.status]).toEqual([400, 400]);

    const processed = await handler(request({ path: '/api/shops/shop1/images/img1/process', body: {} }));
    expect(processed.status).toBe(200);
    expect(images.process).toHaveBeenCalledWith('uid-a', 'shop1', 'img1');
  });

  it('routes item commands and extraction requests', async () => {
    const { handler, items, extractions } = setup();
    expect((await handler(request({ path: '/api/shops/shop1/items', body: { name: '手動の商品', priceJpy: 500 } }))).status).toBe(201);
    expect(items.create).toHaveBeenCalledWith('uid-a', 'shop1', { name: '手動の商品', priceJpy: 500 });

    const patch = await handler(request({ method: 'PATCH', path: '/api/shops/shop1/items/item1', body: { expectedRevision: 0, changes: { priceJpy: 800 } } }));
    expect(patch.status).toBe(200);
    expect(items.update).toHaveBeenCalledWith('uid-a', 'shop1', 'item1', { expectedRevision: 0, changes: { priceJpy: 800 } });

    expect((await handler(request({ method: 'DELETE', path: '/api/shops/shop1/items/item1', body: {} }))).status).toBe(200);
    expect(items.remove).toHaveBeenCalledWith('uid-a', 'shop1', 'item1');

    expect((await handler(request({ path: '/api/shops/shop1/items/reorder', body: { itemIds: ['b', 'a'] } }))).status).toBe(200);
    expect(items.reorder).toHaveBeenCalledWith('uid-a', 'shop1', { itemIds: ['b', 'a'] });

    const job = await handler(request({ path: '/api/shops/shop1/extractions', body: { imageId: 'img1' } }));
    expect(job).toEqual({ status: 202, body: { jobId: 'job1', state: 'queued', duplicate: false } });
    expect(extractions.create).toHaveBeenCalledWith('uid-a', 'shop1', { imageId: 'img1' });
  });

  it('rejects invalid item payloads before calling the service', async () => {
    const { handler, items } = setup();
    for (const body of [{ priceJpy: 12.5 }, { priceJpy: '800' }, { currency: 'USD' }, { taxTreatment: 'maybe' }]) {
      expect((await handler(request({ path: '/api/shops/shop1/items', body }))).status, JSON.stringify(body)).toBe(400);
    }
    expect(items.create).not.toHaveBeenCalled();
  });

  it('distinguishes 404 routes from 405 methods', async () => {
    const { handler } = setup();
    expect((await handler(request({ method: 'GET', path: '/api/unknown' }))).status).toBe(404);
    expect((await handler(request({ method: 'DELETE', path: '/api/shops' }))).status).toBe(405);
  });

  it('requires a valid App Check token when enforced', async () => {
    const verifyAppCheckToken = vi.fn(async (token: string) => {
      if (token !== 'good-app-check') throw new Error('bad');
    });
    const { handler } = setup({ appCheckEnforced: true, verifyAppCheckToken });
    expect((await handler(request())).status).toBe(403);
    expect((await handler(request({ headers: { 'x-firebase-appcheck': 'forged' } }))).status).toBe(403);
    expect((await handler(request({ headers: { 'x-firebase-appcheck': 'good-app-check' } }))).status).toBe(201);
  });

  it('hides unexpected errors behind a retryable 500 and logs only the error class', async () => {
    const log = vi.fn();
    const failing: ShopService = {
      create: async () => {
        throw new RangeError('secret internal detail');
      },
      update: async () => ({ profileRevision: 0, slug: 'x' }),
    };
    const { handler } = setup({ shops: failing, log });
    const response = await handler(request());
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('secret');
    expect(log).toHaveBeenCalledWith('api request failed', { path: '/api/shops', errorClass: 'RangeError' });
  });
});

describe('slugs', () => {
  it('generates 8-character slugs without look-alike characters', () => {
    for (let i = 0; i < 200; i += 1) {
      const slug = randomSlug();
      expect(slug).toMatch(/^[a-km-np-z2-9]{8}$/);
      expect(isClaimableSlug(slug)).toBe(true);
    }
  });

  it('refuses reserved and malformed slugs', () => {
    for (const slug of ['demo', 'api', 'app', 'Bad', '-x-', 'a']) expect(isClaimableSlug(slug), slug).toBe(false);
    expect(isClaimableSlug('matcha-house')).toBe(true);
  });
});
