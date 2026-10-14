import { z } from 'zod';
import { LIMITS, PriceJpy, TaxTreatment } from './common.ts';

export const EXTRACTION_SCHEMA_VERSION = 1;

/** Maximum candidates the schema accepts (shelf mode, Phase 7). MVP single mode creates at most one item. */
export const MAX_EXTRACTION_CANDIDATES = 20;

export const ExtractedItem = z.strictObject({
  name: z.string().trim().min(1).max(LIMITS.nameMaxLength).nullable(),
  description: z.string().trim().max(LIMITS.descriptionMaxLength).nullable(),
  category: z.string().trim().min(1).max(LIMITS.shortTextMaxLength).nullable(),
  priceJpy: PriceJpy,
  taxTreatment: TaxTreatment,
  evidenceText: z.string().max(1000).nullable(),
  uncertainFields: z.array(z.enum(['name', 'description', 'category', 'priceJpy', 'taxTreatment'])).max(5),
});
export type ExtractedItem = z.infer<typeof ExtractedItem>;

/** Model output for one image. Currency is never taken from the model; items are always JPY. */
export const ExtractionOutput = z.strictObject({
  schemaVersion: z.literal(EXTRACTION_SCHEMA_VERSION),
  items: z.array(ExtractedItem).max(MAX_EXTRACTION_CANDIDATES),
  productCountEstimate: z.number().int().nonnegative().max(100),
  warnings: z.array(z.string().max(300)).max(10),
});
export type ExtractionOutput = z.infer<typeof ExtractionOutput>;
