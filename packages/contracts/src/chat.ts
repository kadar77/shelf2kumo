import { z } from 'zod';
import { Description, DocId, HexColorLoose, ItemName, PriceJpy, ShortText, TaxTreatment } from './common.ts';
import { Corners, Density, FontPreset, ImageAspect } from './theme.ts';

/** Chat limits (spec §8). */
export const CHAT_LIMITS = {
  maxMessageLength: 500,
  maxActions: 10,
  dailyRequests: 100,
  contextMessages: 6,
  /** Batches touching more items than this are proposed, not applied automatically. */
  autoApplyMaxItems: 3,
} as const;

/** Named palettes the model (and the theme picker) may choose; all pass WCAG AA. */
export const PaletteName = z.enum(['modern', 'warm', 'cool', 'green', 'mono', 'dark']);
export type PaletteName = z.infer<typeof PaletteName>;

/** Item reference the model must use: `i1`, `i2`… mapped server-side to real IDs of this shop. */
const ItemRef = z.string().regex(/^i\d{1,3}$/);

const ProfileChanges = z
  .strictObject({
    name: ItemName.optional(),
    description: Description.nullable().optional(),
    hours: ShortText.nullable().optional(),
    address: ShortText.nullable().optional(),
    phone: ShortText.nullable().optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0);

const ItemChanges = z
  .strictObject({
    name: ItemName.optional(),
    description: Description.nullable().optional(),
    category: ShortText.nullable().optional(),
    priceJpy: PriceJpy.optional(),
    taxTreatment: TaxTreatment.optional(),
  })
  .refine((changes) => Object.keys(changes).length > 0);

/** Action shapes the model may propose. Anything else makes the whole proposal invalid. */
export const ProposedAction = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('updateProfile'), changes: ProfileChanges }),
  z.strictObject({
    type: z.literal('createItem'),
    fields: z.strictObject({
      name: ItemName,
      description: Description.nullable().optional(),
      category: ShortText.nullable().optional(),
      priceJpy: PriceJpy.optional(),
      taxTreatment: TaxTreatment.optional(),
    }),
  }),
  z.strictObject({ type: z.literal('updateItem'), item: ItemRef, changes: ItemChanges }),
  z.strictObject({ type: z.literal('removeItem'), item: ItemRef }),
  z.strictObject({ type: z.literal('reorderItems'), items: z.array(ItemRef).min(1).max(50) }),
  z.strictObject({
    type: z.literal('setTheme'),
    palette: PaletteName.optional(),
    accent: HexColorLoose.optional(),
    fontPreset: FontPreset.optional(),
    density: Density.optional(),
    corners: Corners.optional(),
    imageAspect: ImageAspect.optional(),
  }),
  z.strictObject({ type: z.literal('requestPreview') }),
  z.strictObject({ type: z.literal('offerPublish') }),
]);
export type ProposedAction = z.infer<typeof ProposedAction>;

/** The model's whole answer (chat-v1). */
export const ChatProposal = z.strictObject({
  message: z.string().trim().min(1).max(500),
  clarification: z.string().trim().min(1).max(300).nullable().optional(),
  actions: z.array(ProposedAction).max(CHAT_LIMITS.maxActions),
});
export type ChatProposal = z.infer<typeof ChatProposal>;

export const SendChatRequest = z
  .strictObject({
    /** Client-generated; replays return the same request (spec §8). */
    requestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    text: z.string().trim().min(1).max(CHAT_LIMITS.maxMessageLength).optional(),
    imageId: DocId.optional(),
  })
  .refine((request) => Boolean(request.text) !== Boolean(request.imageId), 'Send either text or a photo');
export type SendChatRequest = z.infer<typeof SendChatRequest>;

export interface SendChatResponse {
  requestId: string;
  duplicate: boolean;
}

export type ActionState = 'proposed' | 'applied' | 'rejected' | 'undone';

/** One field change shown to the owner as a diff. */
export interface FieldDiff {
  field: string;
  before: string | number | null;
  after: string | number | null;
}

/** Client-readable summary of shops/{shopId}/actions/{actionId}. */
export interface ActionSummary {
  type: ProposedAction['type'] | 'undo';
  state: ActionState;
  requestId: string | null;
  /** Human-readable Japanese target label, e.g. the item name. */
  label: string;
  diffs: FieldDiff[];
  undoable: boolean;
  undoOf: string | null;
  error: string | null;
}

export type ChatMessageRole = 'owner' | 'assistant';

/** Client-readable fields of shops/{shopId}/conversations/main/messages/{messageId}. */
export interface ChatMessageDoc {
  role: ChatMessageRole;
  text: string;
  requestId: string | null;
  imageId: string | null;
  jobId: string | null;
  actionIds: string[];
  /** For assistant messages: a question back to the owner instead of changes. */
  clarification: boolean;
  /** 'fixture' when produced by the emulator-only fixture planner. */
  model: string | null;
}
