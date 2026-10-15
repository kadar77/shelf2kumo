import { z } from 'zod';
import { Description, ItemName, MapUrl, ShortText, Slug } from './common.ts';
import type { StorefrontItem, StorefrontSnapshot } from './storefront.ts';
import type { ThemeTokens } from './theme.ts';

/** Upper bound on shops per owner (abuse guard; multiple shops per owner are allowed). */
export const MAX_SHOPS_PER_OWNER = 10;

/** Slugs that collide with routes or the demo shop. */
export const RESERVED_SLUGS = new Set(['demo', 'admin', 'api', 'app', 'assets', 'media', 'static', 'www', 'help', 'login']);

export const CreateShopRequest = z.strictObject({
  name: ItemName,
  description: Description.nullable().optional(),
});
export type CreateShopRequest = z.infer<typeof CreateShopRequest>;

export interface CreateShopResponse {
  shopId: string;
  slug: string;
}

/** Editable profile fields. Omitted fields are unchanged; null clears an optional field. */
export const ShopProfilePatch = z
  .strictObject({
    name: ItemName.optional(),
    description: Description.nullable().optional(),
    address: ShortText.nullable().optional(),
    phone: ShortText.nullable().optional(),
    hours: ShortText.nullable().optional(),
    mapUrl: MapUrl.nullable().optional(),
    slug: Slug.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'No changes');
export type ShopProfilePatch = z.infer<typeof ShopProfilePatch>;

export const UpdateShopRequest = z.strictObject({
  /** Profile revision the client edited; a mismatch returns 409. */
  expectedRevision: z.number().int().nonnegative(),
  changes: ShopProfilePatch,
});
export type UpdateShopRequest = z.infer<typeof UpdateShopRequest>;

export interface UpdateShopResponse {
  profileRevision: number;
  slug: string;
}

/** Client-readable fields of shops/{shopId}. Timestamps are omitted; the server owns all writes. */
export interface ShopDoc {
  ownerId: string;
  slug: string;
  slugLocked: boolean;
  name: string;
  description: string | null;
  address: string | null;
  phone: string | null;
  hours: string | null;
  mapUrl: string | null;
  isDemo: boolean;
  profileRevision: number;
  contentRevision: number;
  liveReleaseId: string | null;
}

/** Draft item fields relevant to the public snapshot. Draft names may be null until filled in. */
export type SnapshotDraftItem = Omit<StorefrontItem, 'name'> & { name: string | null };

/**
 * The single mapping from saved draft data to the public-field allowlist. Used by the workspace
 * preview and by publishing, so both show exactly the same content. Items without a name are not
 * publishable and are left out.
 */
export function toStorefrontSnapshot(input: {
  shop: ShopDoc;
  items: SnapshotDraftItem[];
  theme: ThemeTokens;
}): StorefrontSnapshot {
  const { shop } = input;
  return {
    schemaVersion: 1,
    shop: {
      slug: shop.slug,
      name: shop.name,
      description: shop.description,
      address: shop.address,
      phone: shop.phone,
      hours: shop.hours,
      mapUrl: shop.mapUrl,
      isDemo: shop.isDemo,
    },
    theme: input.theme,
    items: input.items.flatMap((item) => (item.name ? [{ ...item, name: item.name }] : [])),
  };
}
