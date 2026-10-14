import { z } from 'zod';
import {
  ContentHash,
  Description,
  DocId,
  ItemName,
  LIMITS,
  MapUrl,
  PriceJpy,
  ShortText,
  Slug,
  TaxTreatment,
} from './common.ts';
import { ThemeTokens } from './theme.ts';

export const StorefrontImage = z.strictObject({
  contentHash: ContentHash,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  alt: z.string().max(200),
});
export type StorefrontImage = z.infer<typeof StorefrontImage>;

export const StorefrontItem = z.strictObject({
  id: DocId,
  name: ItemName,
  description: Description.nullable(),
  category: ShortText.nullable(),
  priceJpy: PriceJpy,
  taxTreatment: TaxTreatment,
  image: StorefrontImage.nullable(),
});
export type StorefrontItem = z.infer<typeof StorefrontItem>;

export const StorefrontShop = z.strictObject({
  slug: Slug,
  name: ItemName,
  description: Description.nullable(),
  address: ShortText.nullable(),
  phone: ShortText.nullable(),
  hours: ShortText.nullable(),
  mapUrl: MapUrl.nullable(),
  isDemo: z.boolean(),
});
export type StorefrontShop = z.infer<typeof StorefrontShop>;

/**
 * Public-field allowlist rendered by storefront components. Release snapshots store exactly this
 * shape; the workspace preview builds the same shape from draft data.
 */
export const StorefrontSnapshot = z.strictObject({
  schemaVersion: z.literal(1),
  shop: StorefrontShop,
  theme: ThemeTokens,
  items: z.array(StorefrontItem).max(LIMITS.itemsPerShop),
});
export type StorefrontSnapshot = z.infer<typeof StorefrontSnapshot>;

/** Serialized size in bytes; releases must stay below LIMITS.snapshotMaxBytes. */
export function snapshotByteSize(snapshot: StorefrontSnapshot): number {
  return new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
}
