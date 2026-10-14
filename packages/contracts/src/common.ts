import { z } from 'zod';

/** Application limits (spec §6). Enforced before writing; never rely on Firestore rejecting oversized data. */
export const LIMITS = {
  itemsPerShop: 50,
  nameMaxLength: 200,
  descriptionMaxLength: 2000,
  shortTextMaxLength: 300,
  snapshotMaxBytes: 500 * 1024,
} as const;

/** Lowercase ASCII slug; random 8 characters by default, owner-editable until first publication. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;
export const Slug = z.string().regex(SLUG_PATTERN);

/** Opaque document ID (Firestore auto IDs and deterministic job-derived IDs). */
export const DocId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

/** SHA-256 hex digest. */
export const ContentHash = z.string().regex(/^[a-f0-9]{64}$/);

/** Integer JPY or null when unknown. Null displays as 価格はお問い合わせください. */
export const PriceJpy = z.number().int().nonnegative().max(100_000_000).nullable();

export const TaxTreatment = z.enum(['included', 'excluded', 'unknown']);
export type TaxTreatment = z.infer<typeof TaxTreatment>;

export const ItemName = z.string().trim().min(1).max(LIMITS.nameMaxLength);
export const Description = z.string().trim().max(LIMITS.descriptionMaxLength);
export const ShortText = z.string().trim().min(1).max(LIMITS.shortTextMaxLength);

const MAP_HOSTS = new Set(['www.google.com', 'google.com', 'maps.google.com', 'maps.app.goo.gl', 'goo.gl']);

/** Merchant-supplied map link, restricted to HTTPS Google Maps hosts. */
export const MapUrl = z
  .string()
  .max(500)
  .refine((value) => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !MAP_HOSTS.has(url.hostname)) return false;
      return url.hostname !== 'goo.gl' || url.pathname.startsWith('/maps');
    } catch {
      return false;
    }
  }, 'Must be an https Google Maps link');
