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
    await handleStorefrontRequest({ method: 'GET', path: '/s/Bad_Slug' }, { ...deps, source: { load } });
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
      load: async () => {
        throw new TypeError('Invalid live pointer for shop secret-id');
      },
    };
    const response = await handleStorefrontRequest({ method: 'GET', path: '/s/demo' }, { ...deps, source: failing, log });
    expect(response.status).toBe(500);
    expect(response.headers['Cache-Control']).toBe('no-store');
    expect(response.body).not.toContain('secret-id');
    expect(log).toHaveBeenCalledWith('storefront render failed', { slug: 'demo', errorClass: 'TypeError' });
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
