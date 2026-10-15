import type { StorefrontSnapshot } from '@shelf2kumo/contracts';
import { demoShopSnapshot } from '@shelf2kumo/contracts/fixtures';
import { PALETTES, PRESETS } from '@shelf2kumo/themes';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShopView } from '../src/storefront/components.tsx';
import { publicLinks } from '../src/storefront/links.ts';
import { renderStorefront } from '../src/storefront/server.tsx';
import { PreviewPane } from '../src/workspace/components/PreviewPane.tsx';

const warmSnapshot: StorefrontSnapshot = {
  ...demoShopSnapshot,
  shop: { ...demoShopSnapshot.shop, slug: 'warm-shop', isDemo: false },
  theme: { ...PRESETS.modern, colors: PALETTES.warm.colors, fontPreset: 'mincho', corners: 'round' },
};

describe('preview parity and isolation (P4-4)', () => {
  it('renders the same storefront body as the public page for a customized theme', async () => {
    const page = await renderStorefront({ kind: 'shop', slug: 'warm-shop' }, warmSnapshot, { origin: 'https://example.test', cssHref: '/assets/s.css' });
    expect(page.html).toContain(`--sf-bg:${PALETTES.warm.colors.background}`);
    expect(page.html).toContain(`<body class="sf">${renderToStaticMarkup(<ShopView snapshot={warmSnapshot} links={publicLinks} />)}</body>`);

    const preview = renderToStaticMarkup(<PreviewPane snapshot={warmSnapshot} resolveImage={() => null} />);
    expect(preview).toContain(renderToStaticMarkup(<ShopView snapshot={warmSnapshot} links={{ ...publicLinks, image: () => null }} />));
  });

  it('scopes theme tokens to the preview container only', () => {
    const preview = renderToStaticMarkup(<PreviewPane snapshot={warmSnapshot} resolveImage={() => null} />);
    const styled = [...preview.matchAll(/<(\w+)[^>]*style="([^"]*)"/g)];
    expect(styled).toHaveLength(1);
    expect(styled[0]?.[0]).toContain('class="sf"');
    expect(styled[0]?.[2]).toContain(`--sf-bg:${PALETTES.warm.colors.background}`);
    expect(preview).not.toMatch(/--ws-/);
  });
});
