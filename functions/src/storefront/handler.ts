import { matchMediaPath, matchStorefrontPath, renderSitemap, renderStorefront } from '@shelf2kumo/web/storefront/server';
import type { SnapshotSource } from './source.ts';

export interface StorefrontRequest {
  method: string;
  path: string;
}

export interface StorefrontResponse {
  status: number;
  headers: Record<string, string>;
  body: string | Buffer;
}

export interface StorefrontDeps {
  source: SnapshotSource;
  origin: string;
  cssHref: string;
  /** Reads a private rendition for the /media route. */
  readMedia?: (path: string) => Promise<Buffer>;
  log?: (message: string, data: Record<string, unknown>) => void;
}

const ERROR_HTML =
  '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>エラー | Shelf2Kumo</title></head>' +
  '<body><p>ページを表示できませんでした。時間をおいて再度お試しください。</p></body></html>';

const NOT_FOUND = {
  status: 404,
  headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=0, s-maxage=10', 'X-Content-Type-Options': 'nosniff' },
  body: 'Not Found',
};

/**
 * Framework-independent public handler: storefront pages, published media and sitemap. Everything
 * is read from the live release, so drafts and unpublished shops are never served.
 */
export async function handleStorefrontRequest(request: StorefrontRequest, deps: StorefrontDeps): Promise<StorefrontResponse> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return {
      status: 405,
      headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
      body: 'Method Not Allowed',
    };
  }
  const head = request.method === 'HEAD';

  try {
    if (request.path === '/sitemap.xml') {
      const sitemap = renderSitemap(deps.origin, await deps.source.listPublished());
      return { status: 200, headers: sitemap.headers, body: head ? '' : sitemap.html };
    }

    if (request.path.startsWith('/media/')) {
      const media = matchMediaPath(request.path);
      const release = media ? await deps.source.loadRelease(media.slug) : null;
      const path = media && release ? release.media[media.contentHash] : undefined;
      if (!path || !deps.readMedia) return NOT_FOUND;
      const bytes = await deps.readMedia(path);
      return {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=300, s-maxage=300',
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy': "default-src 'none'",
        },
        body: head ? '' : bytes,
      };
    }

    const route = matchStorefrontPath(request.path);
    const snapshot = route ? await deps.source.load(route.slug) : null;
    const result = await renderStorefront(route, snapshot, { origin: deps.origin, cssHref: deps.cssHref });
    return { status: result.status, headers: result.headers, body: head ? '' : result.html };
  } catch (error) {
    deps.log?.('storefront render failed', {
      path: request.path.slice(0, 120),
      errorClass: error instanceof Error ? error.name : 'unknown',
    });
    return {
      status: 500,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' },
      body: head ? '' : ERROR_HTML,
    };
  }
}
