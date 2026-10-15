import {
  AllocateUploadRequest,
  CreateExtractionRequest,
  CreateItemRequest,
  CreateShopRequest,
  ReorderItemsRequest,
  UpdateItemRequest,
  UpdateShopRequest,
} from '@shelf2kumo/contracts';
import type { ExtractionJobService } from '../extraction/jobs.ts';
import type { ImageService } from '../images/service.ts';
import type { ItemService } from '../items/service.ts';
import type { ShopService } from '../shops/service.ts';
import { authenticate, type AuthDeps } from './auth.ts';
import { HttpError, MAX_JSON_BODY_BYTES, errorResponse, parseBody, type ApiRequest, type ApiResponse } from './http.ts';

export interface ApiDeps extends AuthDeps {
  shops: ShopService;
  images: ImageService;
  items: ItemService;
  extractions: ExtractionJobService;
  log?: (message: string, data: Record<string, unknown>) => void;
}

interface RouteContext {
  request: ApiRequest;
  params: string[];
  uid: string;
}

interface Route {
  method: string;
  pattern: RegExp;
  public?: boolean;
  handle(context: RouteContext): Promise<ApiResponse> | ApiResponse;
}

const ID = '([A-Za-z0-9_-]{1,64})';

function routes(deps: ApiDeps): Route[] {
  return [
    { method: 'GET', pattern: /^\/api\/health$/, public: true, handle: () => ({ status: 200, body: { ok: true } }) },
    {
      method: 'POST',
      pattern: /^\/api\/shops$/,
      handle: async ({ request, uid }) => ({
        status: 201,
        body: await deps.shops.create(uid, parseBody(CreateShopRequest, request.body)),
      }),
    },
    {
      method: 'PATCH',
      pattern: new RegExp(`^/api/shops/${ID}$`),
      handle: async ({ request, params, uid }) => ({
        status: 200,
        body: await deps.shops.update(uid, params[0] as string, parseBody(UpdateShopRequest, request.body)),
      }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/shops/${ID}/uploads$`),
      handle: async ({ request, params, uid }) => ({
        status: 201,
        body: await deps.images.allocate(uid, params[0] as string, parseBody(AllocateUploadRequest, request.body)),
      }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/shops/${ID}/images/${ID}/process$`),
      handle: async ({ params, uid }) => ({
        status: 200,
        body: await deps.images.process(uid, params[0] as string, params[1] as string),
      }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/shops/${ID}/extractions$`),
      handle: async ({ request, params, uid }) => ({
        status: 202,
        body: await deps.extractions.create(uid, params[0] as string, parseBody(CreateExtractionRequest, request.body)),
      }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/shops/${ID}/items$`),
      handle: async ({ request, params, uid }) => ({
        status: 201,
        body: await deps.items.create(uid, params[0] as string, parseBody(CreateItemRequest, request.body)),
      }),
    },
    {
      method: 'POST',
      pattern: new RegExp(`^/api/shops/${ID}/items/reorder$`),
      handle: async ({ request, params, uid }) => {
        await deps.items.reorder(uid, params[0] as string, parseBody(ReorderItemsRequest, request.body));
        return { status: 200, body: { ok: true } };
      },
    },
    {
      method: 'PATCH',
      pattern: new RegExp(`^/api/shops/${ID}/items/${ID}$`),
      handle: async ({ request, params, uid }) => ({
        status: 200,
        body: await deps.items.update(uid, params[0] as string, params[1] as string, parseBody(UpdateItemRequest, request.body)),
      }),
    },
    {
      method: 'DELETE',
      pattern: new RegExp(`^/api/shops/${ID}/items/${ID}$`),
      handle: async ({ params, uid }) => {
        await deps.items.remove(uid, params[0] as string, params[1] as string);
        return { status: 200, body: { ok: true } };
      },
    },
  ];
}

/** Same-origin JSON command API. Every non-public route authenticates before touching data. */
export function createApiHandler(deps: ApiDeps): (request: ApiRequest) => Promise<ApiResponse> {
  const table = routes(deps);

  return async (request) => {
    try {
      const matching = table.filter((route) => route.pattern.test(request.path));
      if (matching.length === 0) throw new HttpError(404, 'not_found', 'API が見つかりません。');
      const route = matching.find((candidate) => candidate.method === request.method);
      if (!route) throw new HttpError(405, 'method_not_allowed', 'この操作はできません。');

      if (route.method !== 'GET') {
        if (request.rawBodyBytes > MAX_JSON_BODY_BYTES) throw new HttpError(413, 'payload_too_large', '送信内容が大きすぎます。');
        if (!(request.header('content-type') ?? '').startsWith('application/json')) {
          throw new HttpError(400, 'bad_request', 'JSON で送信してください。');
        }
      }

      const uid = route.public ? '' : await authenticate(request, deps);
      const params = (route.pattern.exec(request.path) ?? []).slice(1);
      return await route.handle({ request, params, uid });
    } catch (error) {
      if (error instanceof HttpError) return errorResponse(error);
      deps.log?.('api request failed', { path: request.path, errorClass: error instanceof Error ? error.name : 'unknown' });
      return errorResponse(new HttpError(500, 'internal', 'エラーが発生しました。時間をおいて再度お試しください。', true));
    }
  };
}
