import { describe, expect, it, vi } from 'vitest';
import { handleStorefrontRequest } from '../src/storefront/handler.ts';
import { fixtureSnapshotSource, shouldUseFixtures, type SnapshotSource } from '../src/storefront/source.ts';

const deps = { source: fixtureSnapshotSource, origin: 'https://example.test', cssHref: '/assets/storefront-x.css' };

describe('handleStorefrontRequest', () => {
  it('serves the fixture demo shop with cache and CSP headers', async () => {
    const response = await handleStorefrontRequest({ method: 'GET', path: '/s/demo' }, deps);
    expect(response.status).toBe(200);
    expect(response.headers['Cache-Control']).toBe('public, max-age=0, s-maxage=60');
    expect(response.headers['Content-Security-Policy']).toContain("default-src 'none'");
    expect(response.body).toContain('器と道具 こもれび（デモ）');
  });

  it('returns 404 for unknown slugs and malformed paths', async () => {
    for (const path of ['/s/unknown', '/s/demo/p/missing', '/s/../etc', '/s']) {
      const response = await handleStorefrontRequest({ method: 'GET', path }, deps);
      expect(response.status, path).toBe(404);
    }
  });

  it('does not query the source for invalid routes', async () => {
    const load = vi.fn<SnapshotSource['load']>(async () => null);
    await handleStorefrontRequest({ method: 'GET', path: '/s/Bad_Slug' }, { ...deps, source: { ...fixtureSnapshotSource, load } });
    expect(load).not.toHaveBeenCalled();
  });

  it('answers HEAD without a body and rejects other methods', async () => {
    const head = await handleStorefrontRequest({ method: 'HEAD', path: '/s/demo' }, deps);
    expect(head.status).toBe(200);
    expect(head.body).toBe('');

    const post = await handleStorefrontRequest({ method: 'POST', path: '/s/demo' }, deps);
    expect(post.status).toBe(405);
    expect(post.headers.Allow).toBe('GET, HEAD');
  });

  it('fails closed with an uncached 500 and a sanitized log on source errors', async () => {
    const log = vi.fn();
    const failing: SnapshotSource = {
      ...fixtureSnapshotSource,
      load: async () => {
        throw new TypeError('Invalid live pointer for shop secret-id');
      },
    };
    const response = await handleStorefrontRequest({ method: 'GET', path: '/s/demo' }, { ...deps, source: failing, log });
    expect(response.status).toBe(500);
    expect(response.headers['Cache-Control']).toBe('no-store');
    expect(response.body).not.toContain('secret-id');
    expect(log).toHaveBeenCalledWith('storefront render failed', { path: '/s/demo', errorClass: 'TypeError' });
  });
});

describe('shouldUseFixtures', () => {
  it('never uses fixtures outside the emulator', () => {
    expect(shouldUseFixtures({ STOREFRONT_FIXTURES: 'true' })).toBe(false);
    expect(shouldUseFixtures({})).toBe(false);
  });

  it('uses fixtures in the emulator without a Firestore emulator', () => {
    expect(shouldUseFixtures({ FUNCTIONS_EMULATOR: 'true' })).toBe(true);
    expect(shouldUseFixtures({ FUNCTIONS_EMULATOR: 'true', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' })).toBe(false);
  });
});

describe('published media and sitemap', () => {
  const hash = 'c'.repeat(64);
  const release: SnapshotSource = {
    load: async () => null,
    loadRelease: async (slug) => (slug === 'live-shop' ? { snapshot: {} as never, media: { [hash]: 'owners/uid/shops/s1/renditions/img.jpg' } } : null),
    listPublished: async () => ['live-shop', 'other-shop'],
  };
  const readMedia = vi.fn(async () => Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  it('serves only photos referenced by the live release, without exposing storage paths', async () => {
    const ok = await handleStorefrontRequest({ method: 'GET', path: `/media/live-shop/${hash}.jpg` }, { ...deps, source: release, readMedia });
    expect(ok.status).toBe(200);
    expect(ok.headers['Content-Type']).toBe('image/jpeg');
    expect(ok.headers['Cache-Control']).toBe('public, max-age=300, s-maxage=300');
    expect(readMedia).toHaveBeenCalledWith('owners/uid/shops/s1/renditions/img.jpg');
    expect(JSON.stringify(ok.headers)).not.toContain('owners/');

    for (const path of [`/media/live-shop/${'d'.repeat(64)}.jpg`, `/media/unpublished/${hash}.jpg`, '/media/live-shop/../secret.jpg', `/media/live-shop/${hash}.png`]) {
      const missing = await handleStorefrontRequest({ method: 'GET', path }, { ...deps, source: release, readMedia });
      expect(missing.status, path).toBe(404);
    }
  });

  it('lists live catalogs in sitemap.xml', async () => {
    const sitemap = await handleStorefrontRequest({ method: 'GET', path: '/sitemap.xml' }, { ...deps, source: release });
    expect(sitemap.status).toBe(200);
    expect(sitemap.headers['Content-Type']).toBe('application/xml; charset=utf-8');
    expect(sitemap.body).toContain('<loc>https://example.test/s/live-shop</loc>');
    expect(sitemap.body).toContain('<loc>https://example.test/s/other-shop</loc>');
  });
});
