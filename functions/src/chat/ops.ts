import type { FieldDiff, ItemDoc, ThemeTokens } from '@shelf2kumo/contracts';

/**
 * Server-resolved operations: real IDs and expected revisions filled in by the server from the state
 * the model saw (never from model output). Stored on action documents so apply/undo can re-check.
 */
export type ProfileFields = Partial<Record<'name' | 'description' | 'hours' | 'address' | 'phone', string | null>>;
export type ItemFields = Partial<Pick<ItemDoc, 'name' | 'description' | 'category' | 'priceJpy' | 'taxTreatment'>>;

export type ResolvedOp =
  | { type: 'updateProfile'; changes: ProfileFields; expectedRevision: number }
  | { type: 'createItem'; itemId: string; fields: ItemFields }
  | { type: 'updateItem'; itemId: string; changes: ItemFields; expectedRevision: number }
  | { type: 'removeItem'; itemId: string; expectedRevision: number }
  | { type: 'restoreItem'; itemId: string; item: ItemDoc }
  | { type: 'reorderItems'; itemIds: string[]; expectedOrder: string[] }
  | { type: 'setTheme'; tokens: ThemeTokens; expectedRevision: number; accentAdjusted: boolean }
  | { type: 'requestPreview' }
  | { type: 'offerPublish' };

export const isMutation = (op: ResolvedOp) => op.type !== 'requestPreview' && op.type !== 'offerPublish';

/** Result of applying one operation: what changed, for diffs and undo. */
export interface AppliedRecord {
  op: ResolvedOp;
  label: string;
  diffs: FieldDiff[];
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  /** Revision of the target after this operation (undo expects it unchanged). */
  afterRevision: number | null;
  undoable: boolean;
}

/** Japanese conflict message; the batch was not applied. */
export class ApplyConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApplyConflict';
  }
}
