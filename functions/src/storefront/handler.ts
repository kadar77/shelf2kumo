import { matchStorefrontPath, renderStorefront } from '@shelf2kumo/web/storefront/server';
import type { SnapshotSource } from './source.ts';

export interface StorefrontRequest {
  method: string;
  path: string;
}

export interface StorefrontResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface StorefrontDeps {
  source: SnapshotSource;
  origin: string;
  cssHref: string;
  log?: (message: string, data: Record<string, unknown>) => void;
}

const ERROR_HTML =
  '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>エラー | Shelf2Kumo</title></head>' +
  '<body><p>ページを表示できませんでした。時間をおいて再度お試しください。</p></body></html>';

/** Framework-independent storefront handler: resolves the route, loads the live snapshot and renders. */
export async function handleStorefrontRequest(
  request: StorefrontRequest,
  deps: StorefrontDeps,
): Promise<StorefrontResponse> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return {
      status: 405,
      headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8' },
      body: 'Method Not Allowed',
    };
  }

  const route = matchStorefrontPath(request.path);
  try {
    const snapshot = route ? await deps.source.load(route.slug) : null;
    const result = await renderStorefront(route, snapshot, { origin: deps.origin, cssHref: deps.cssHref });
    return { status: result.status, headers: result.headers, body: request.method === 'HEAD' ? '' : result.html };
  } catch (error) {
    deps.log?.('storefront render failed', {
      slug: route?.slug ?? null,
      errorClass: error instanceof Error ? error.name : 'unknown',
    });
    return {
      status: 500,
      headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/html; charset=utf-8' },
      body: request.method === 'HEAD' ? '' : ERROR_HTML,
    };
  }
}
