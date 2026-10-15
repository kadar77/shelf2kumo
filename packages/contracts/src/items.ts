import { z } from 'zod';
import { Description, DocId, ItemName, LIMITS, PriceJpy, ShortText, TaxTreatment } from './common.ts';

export const ItemField = z.enum(['name', 'description', 'category', 'priceJpy', 'taxTreatment']);
export type ItemField = z.infer<typeof ItemField>;

/** Editable item fields. Draft names may be null (filled in before publication). */
const editableFields = {
  name: ItemName.nullable(),
  description: Description.nullable(),
  category: ShortText.nullable(),
  priceJpy: PriceJpy,
  taxTreatment: TaxTreatment,
  imageId: DocId.nullable(),
};

export const CreateItemRequest = z.strictObject({
  name: editableFields.name.optional(),
  description: editableFields.description.optional(),
  category: editableFields.category.optional(),
  priceJpy: editableFields.priceJpy.optional(),
  taxTreatment: editableFields.taxTreatment.optional(),
  imageId: editableFields.imageId.optional(),
});
export type CreateItemRequest = z.infer<typeof CreateItemRequest>;

export const ItemPatch = z
  .strictObject({
    name: editableFields.name.optional(),
    description: editableFields.description.optional(),
    category: editableFields.category.optional(),
    priceJpy: editableFields.priceJpy.optional(),
    taxTreatment: editableFields.taxTreatment.optional(),
    imageId: editableFields.imageId.optional(),
  })
  .refine((patch) => Object.keys(patch).length > 0, 'No changes');
export type ItemPatch = z.infer<typeof ItemPatch>;

export const UpdateItemRequest = z.strictObject({
  /** Revision of this item only; other items and the profile never cause a conflict. */
  expectedRevision: z.number().int().nonnegative(),
  changes: ItemPatch,
});
export type UpdateItemRequest = z.infer<typeof UpdateItemRequest>;

export const ReorderItemsRequest = z.strictObject({
  itemIds: z.array(DocId).min(1).max(LIMITS.itemsPerShop),
});
export type ReorderItemsRequest = z.infer<typeof ReorderItemsRequest>;

export interface CreateItemResponse {
  itemId: string;
}

export interface UpdateItemResponse {
  revision: number;
}

/** Client-readable fields of shops/{shopId}/items/{itemId}. */
export interface ItemDoc {
  name: string | null;
  description: string | null;
  category: string | null;
  priceJpy: number | null;
  currency: 'JPY';
  taxTreatment: z.infer<typeof TaxTreatment>;
  imageId: string | null;
  order: number;
  revision: number;
  /** Extraction job that created the item, if any (provenance). */
  sourceJobId: string | null;
  /** Fields the model was unsure about; cleared per field when the owner edits it. Informational only. */
  uncertainFields: ItemField[];
}
