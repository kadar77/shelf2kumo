import { DocId, Slug, type StorefrontSnapshot } from '@shelf2kumo/contracts';
import { PRESETS, cssVarsToRule, themeToCssVars } from '@shelf2kumo/themes';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NotFoundView, ProductView, ShopView } from './components.tsx';
import { summarize } from './format.ts';
import { publicLinks } from './links.ts';

/*
 * SSR entry for the storefront function. Renders every shop from its release snapshot as static
 * HTML: no hydration and no client JavaScript.
 */

export type StorefrontRoute = { kind: 'shop'; slug: string } | { kind: 'product'; slug: string; itemId: string };

export interface RenderOptions {
  /** Canonical public origin, e.g. https://shelf2kumo.web.app (never derived from request headers). */
  origin: string;
  /** Fingerprinted storefront stylesheet path from the Vite manifest. */
  cssHref: string;
}

export interface RenderResult {
  status: 200 | 404;
  html: string;
  headers: Record<string, string>;
}

const CACHE_CONTROL = {
  200: 'public, max-age=0, s-maxage=60',
  404: 'public, max-age=0, s-maxage=10',
} as const;

/** Parses /s/:slug and /s/:slug/p/:itemId. Anything else (including encoded characters) is not a route. */
export function matchStorefrontPath(pathname: string): StorefrontRoute | null {
  const match = /^\/s\/([^/]+)(?:\/p\/([^/]+))?\/?$/.exec(pathname);
  if (!match) return null;
  const slug = Slug.safeParse(match[1]);
  if (!slug.success) return null;
  if (match[2] === undefined) return { kind: 'shop', slug: slug.data };
  const itemId = DocId.safeParse(match[2]);
  return itemId.success ? { kind: 'product', slug: slug.data, itemId: itemId.data } : null;
}

interface PageMeta {
  title: string;
  description: string;
  canonical: string | null;
  ogType: 'website' | 'product';
  ogImage: string | null;
  siteName: string | null;
  noindex: boolean;
}

function Document({
  meta,
  cssHref,
  themeCss,
  themeColor,
  children,
}: {
  meta: PageMeta;
  cssHref: string;
  themeCss: string;
  themeColor: string;
  children: ReactNode;
}) {
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{meta.title}</title>
        <meta name="description" content={meta.description} />
        {meta.noindex && <meta name="robots" content="noindex" />}
        {meta.canonical && <link rel="canonical" href={meta.canonical} />}
        <meta property="og:type" content={meta.ogType} />
        <meta property="og:title" content={meta.title} />
        <meta property="og:description" content={meta.description} />
        <meta property="og:locale" content="ja_JP" />
        {meta.canonical && <meta property="og:url" content={meta.canonical} />}
        {meta.siteName && <meta property="og:site_name" content={meta.siteName} />}
        {meta.ogImage && <meta property="og:image" content={meta.ogImage} />}
        <meta name="theme-color" content={themeColor} />
        <link rel="stylesheet" href={cssHref} />
        <style dangerouslySetInnerHTML={{ __html: themeCss }} />
      </head>
      <body className="sf">{children}</body>
    </html>
  );
}

async function sha256Base64(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  let binary = '';
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function securityHeaders(themeCss: string): Promise<Record<string, string>> {
  const styleHash = await sha256Base64(themeCss);
  return {
    'Content-Security-Policy': [
      "default-src 'none'",
      "img-src 'self'",
      `style-src 'self' 'sha256-${styleHash}'`,
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
}

async function respond(
  status: 200 | 404,
  page: { meta: PageMeta; snapshot: StorefrontSnapshot | null; body: ReactNode },
  options: RenderOptions,
): Promise<RenderResult> {
  const theme = page.snapshot?.theme ?? PRESETS.modern;
  const themeCss = cssVarsToRule(themeToCssVars(theme));
  const markup = renderToStaticMarkup(
    <Document meta={page.meta} cssHref={options.cssHref} themeCss={themeCss} themeColor={theme.colors.background}>
      {page.body}
    </Document>,
  );
  return {
    status,
    html: `<!doctype html>${markup}`,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': CACHE_CONTROL[status],
      ...(await securityHeaders(themeCss)),
    },
  };
}

function notFound(options: RenderOptions): Promise<RenderResult> {
  return respond(
    404,
    {
      meta: {
        title: 'ページが見つかりません | Shelf2Kumo',
        description: 'お探しのページは見つかりませんでした。',
        canonical: null,
        ogType: 'website',
        ogImage: null,
        siteName: null,
        noindex: true,
      },
      snapshot: null,
      body: <NotFoundView />,
    },
    options,
  );
}

/** Renders a storefront route from a validated release snapshot. A missing snapshot or item is a 404. */
export async function renderStorefront(
  route: StorefrontRoute | null,
  snapshot: StorefrontSnapshot | null,
  options: RenderOptions,
): Promise<RenderResult> {
  if (!route || !snapshot || snapshot.shop.slug !== route.slug) return notFound(options);

  const { shop } = snapshot;
  const origin = options.origin.replace(/\/+$/, '');

  if (route.kind === 'shop') {
    return respond(
      200,
      {
        meta: {
          title: `${shop.name} | 商品一覧`,
          description: summarize(shop.description ?? `${shop.name}の商品一覧です。`),
          canonical: `${origin}${publicLinks.shop(shop.slug)}`,
          ogType: 'website',
          ogImage: null,
          siteName: shop.name,
          noindex: shop.isDemo,
        },
        snapshot,
        body: <ShopView snapshot={snapshot} links={publicLinks} />,
      },
      options,
    );
  }

  const item = snapshot.items.find((candidate) => candidate.id === route.itemId);
  if (!item) return notFound(options);
  const imagePath = item.image ? publicLinks.image(shop.slug, item.image) : null;

  return respond(
    200,
    {
      meta: {
        title: `${item.name} | ${shop.name}`,
        description: summarize(item.description ?? `${shop.name}の「${item.name}」です。`),
        canonical: `${origin}${publicLinks.product(shop.slug, item.id)}`,
        ogType: 'product',
        ogImage: imagePath ? `${origin}${imagePath}` : null,
        siteName: shop.name,
        noindex: shop.isDemo,
      },
      snapshot,
      body: <ProductView snapshot={snapshot} links={publicLinks} item={item} />,
    },
    options,
  );
}

const xmlEscape = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** sitemap.xml for live, non-demo catalogs (shop pages). */
export function renderSitemap(origin: string, slugs: string[]): RenderResult & { status: 200 } {
  const base = origin.replace(/\/+$/, '');
  const urls = slugs
    .filter((slug) => Slug.safeParse(slug).success)
    .map((slug) => `  <url><loc>${xmlEscape(`${base}${publicLinks.shop(slug)}`)}</loc></url>`)
    .join('\n');
  return {
    status: 200,
    html: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`,
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=0, s-maxage=300', 'X-Content-Type-Options': 'nosniff' },
  };
}

/** Parses /media/:slug/:contentHash.jpg (published photos only). */
export function matchMediaPath(pathname: string): { slug: string; contentHash: string } | null {
  const match = /^\/media\/([^/]+)\/([a-f0-9]{64})\.jpg$/.exec(pathname);
  if (!match) return null;
  const slug = Slug.safeParse(match[1]);
  return slug.success ? { slug: slug.data, contentHash: match[2] as string } : null;
}
