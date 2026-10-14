import type { StorefrontSnapshot } from '@shelf2kumo/contracts';
import { demoShopSnapshot } from '@shelf2kumo/contracts/fixtures';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShopView } from '../src/storefront/components.tsx';
import { PRICE_UNKNOWN_LABEL, formatPrice } from '../src/storefront/format.ts';
import { publicLinks } from '../src/storefront/links.ts';
import { matchStorefrontPath, renderStorefront } from '../src/storefront/server.tsx';

const options = { origin: 'https://example.test', cssHref: '/assets/storefront-abc123.css' };

const realShop: StorefrontSnapshot = {
  ...demoShopSnapshot,
  shop: { ...demoShopSnapshot.shop, slug: 'k3x9a2bq', isDemo: false, phone: '03-1234-5678' },
};

describe('formatPrice', () => {
  it('formats integer JPY with tax treatment', () => {
    expect(formatPrice(3300, 'included')).toBe('3,300円（税込）');
    expect(formatPrice(1800, 'excluded')).toBe('1,800円（税抜）');
    expect(formatPrice(0, 'unknown')).toBe('0円');
  });

  it('shows the inquiry label for unknown prices', () => {
    expect(formatPrice(null, 'unknown')).toBe(PRICE_UNKNOWN_LABEL);
    expect(PRICE_UNKNOWN_LABEL).toBe('価格はお問い合わせください');
  });
});

describe('matchStorefrontPath', () => {
  it('matches shop and product routes', () => {
    expect(matchStorefrontPath('/s/demo')).toEqual({ kind: 'shop', slug: 'demo' });
    expect(matchStorefrontPath('/s/demo/')).toEqual({ kind: 'shop', slug: 'demo' });
    expect(matchStorefrontPath('/s/demo/p/demoItem01')).toEqual({ kind: 'product', slug: 'demo', itemId: 'demoItem01' });
  });

  it('rejects anything else', () => {
    for (const path of ['/s', '/s/', '/s/Demo', '/s/demo/x', '/s/demo/p/', '/s/de%2Fmo', '/s/demo/p/a/b', '/app/s/demo']) {
      expect(matchStorefrontPath(path), path).toBeNull();
    }
  });
});

describe('renderStorefront', () => {
  it('renders the shop page as complete Japanese HTML with metadata', async () => {
    const result = await renderStorefront({ kind: 'shop', slug: realShop.shop.slug }, realShop, options);
    expect(result.status).toBe(200);
    expect(result.html.startsWith('<!doctype html><html lang="ja">')).toBe(true);
    expect(result.html).toContain(`<link rel="canonical" href="https://example.test/s/${realShop.shop.slug}"/>`);
    expect(result.html).toContain('property="og:title"');
    expect(result.html).toContain('href="/assets/storefront-abc123.css"');
    expect(result.html).not.toContain('noindex');
    for (const item of realShop.items) expect(result.html).toContain(item.name);
    expect(result.html).toContain('価格はお問い合わせください');
    expect(result.html).toContain('href="tel:0312345678"');
    expect(result.html).not.toContain('<script');
  });

  it('renders product pages with shop contact information in the first response', async () => {
    const item = realShop.items[0]!;
    const result = await renderStorefront({ kind: 'product', slug: realShop.shop.slug, itemId: item.id }, realShop, options);
    expect(result.status).toBe(200);
    expect(result.html).toContain(`<h1>${item.name}</h1>`);
    expect(result.html).toContain('3,300円（税込）');
    expect(result.html).toContain('11:00〜18:00（火曜定休）');
  });

  it('marks demo shops noindex and visibly labeled', async () => {
    const result = await renderStorefront({ kind: 'shop', slug: 'demo' }, demoShopSnapshot, options);
    expect(result.html).toContain('<meta name="robots" content="noindex"/>');
    expect(result.html).toContain('デモ用のサンプル店舗');
  });

  it('returns 404 for unknown shops, items and slug mismatches', async () => {
    const missingShop = await renderStorefront({ kind: 'shop', slug: 'nothere' }, null, options);
    const missingItem = await renderStorefront({ kind: 'product', slug: 'demo', itemId: 'nope' }, demoShopSnapshot, options);
    const mismatch = await renderStorefront({ kind: 'shop', slug: 'other' }, demoShopSnapshot, options);
    for (const result of [missingShop, missingItem, mismatch]) {
      expect(result.status).toBe(404);
      expect(result.headers['Cache-Control']).toBe('public, max-age=0, s-maxage=10');
      expect(result.html).toContain('ページが見つかりません');
    }
  });

  it('escapes merchant and AI-provided text', async () => {
    const hostile: StorefrontSnapshot = {
      ...realShop,
      shop: { ...realShop.shop, name: '<script>alert(1)</script>', description: '"><img src=x onerror=alert(1)>' },
      items: [{ ...realShop.items[0]!, name: '</style><script>alert(2)</script>' }],
    };
    const result = await renderStorefront({ kind: 'shop', slug: hostile.shop.slug }, hostile, options);
    expect(result.html).not.toContain('<script>');
    expect(result.html).not.toContain('<img src=x');
    expect(result.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('sends cache and security headers with a CSP hash matching the inline token block', async () => {
    const result = await renderStorefront({ kind: 'shop', slug: realShop.shop.slug }, realShop, options);
    expect(result.headers['Cache-Control']).toBe('public, max-age=0, s-maxage=60');
    const csp = result.headers['Content-Security-Policy'] ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('script-src');
    expect(csp).not.toContain('unsafe-inline');

    const style = /<style>(.*?)<\/style>/.exec(result.html)?.[1] ?? '';
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(style)));
    const hash = btoa(String.fromCharCode(...digest));
    expect(csp).toContain(`'sha256-${hash}'`);
  });

  it('produces the same storefront markup as the workspace preview for one snapshot', async () => {
    const result = await renderStorefront({ kind: 'shop', slug: realShop.shop.slug }, realShop, options);
    const previewMarkup = renderToStaticMarkup(<ShopView snapshot={realShop} links={publicLinks} />);
    expect(result.html).toContain(`<body class="sf">${previewMarkup}</body>`);
  });
});
