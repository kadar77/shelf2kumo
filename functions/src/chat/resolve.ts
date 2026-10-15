import type { ChatContext } from '@shelf2kumo/ai';
import { CHAT_LIMITS, type ChatProposal, type ItemDoc, type ShopDoc, type ThemeTokens } from '@shelf2kumo/contracts';
import { applyThemeChoice, paletteOf } from '@shelf2kumo/themes';
import type { Firestore } from 'firebase-admin/firestore';
import { themeFrom, themeRef } from './apply.ts';
import { isMutation, type ResolvedOp } from './ops.ts';

/** What the model saw: context with item refs, plus the revisions used to fill expected values. */
export interface PlanningState {
  context: ChatContext;
  refToItemId: Map<string, string>;
  itemRevisions: Map<string, number>;
  itemOrder: string[];
  profileRevision: number;
  theme: { tokens: ThemeTokens; revision: number };
}

export async function loadPlanningState(db: Firestore, shopId: string, recentMessages: ChatContext['recentMessages']): Promise<PlanningState> {
  const [shopSnapshot, itemsSnapshot, themeSnapshot] = await Promise.all([
    db.doc(`shops/${shopId}`).get(),
    db.collection(`shops/${shopId}/items`).orderBy('order').get(),
    themeRef(db, shopId).get(),
  ]);
  const shop = shopSnapshot.data() as ShopDoc;
  const theme = themeFrom(themeSnapshot);
  const refToItemId = new Map<string, string>();
  const itemRevisions = new Map<string, number>();
  const items = itemsSnapshot.docs.map((doc, index) => {
    const item = doc.data() as ItemDoc;
    const ref = `i${index + 1}`;
    refToItemId.set(ref, doc.id);
    itemRevisions.set(doc.id, item.revision);
    return {
      ref,
      name: item.name,
      priceJpy: item.priceJpy,
      taxTreatment: item.taxTreatment,
      category: item.category,
      description: item.description ? item.description.slice(0, 200) : null,
    };
  });
  return {
    context: {
      shop: { name: shop.name, description: shop.description, hours: shop.hours, address: shop.address, phone: shop.phone },
      items,
      theme: { palette: paletteOf(theme.tokens.colors), fontPreset: theme.tokens.fontPreset, density: theme.tokens.density, corners: theme.tokens.corners },
      recentMessages,
    },
    refToItemId,
    itemRevisions,
    itemOrder: itemsSnapshot.docs.map((doc) => doc.id),
    profileRevision: Number(shop.profileRevision ?? 0),
    theme,
  };
}

export type Resolution =
  | { kind: 'ok'; ops: ResolvedOp[]; policy: 'auto' | 'proposed' }
  | { kind: 'invalid'; reason: string };

/**
 * Maps model refs to this shop's item IDs and fills expected revisions from the planning state.
 * Unknown refs reject the whole proposal (no partial changes). Removals and batches touching more
 * than three items are proposed for the owner to apply (spec §8 apply policy).
 */
export function resolveProposal(proposal: ChatProposal, state: PlanningState, newItemId: () => string): Resolution {
  const ops: ResolvedOp[] = [];
  const itemIdOf = (ref: string) => state.refToItemId.get(ref);
  let themeTokens = state.theme.tokens;

  for (const action of proposal.actions) {
    switch (action.type) {
      case 'updateProfile':
        ops.push({ type: 'updateProfile', changes: action.changes, expectedRevision: state.profileRevision });
        break;
      case 'createItem':
        ops.push({ type: 'createItem', itemId: newItemId(), fields: action.fields });
        break;
      case 'updateItem':
      case 'removeItem': {
        const itemId = itemIdOf(action.item);
        if (!itemId) return { kind: 'invalid', reason: `存在しない商品（${action.item}）が指定されました。` };
        const expectedRevision = state.itemRevisions.get(itemId) ?? 0;
        ops.push(action.type === 'updateItem' ? { type: 'updateItem', itemId, changes: action.changes, expectedRevision } : { type: 'removeItem', itemId, expectedRevision });
        break;
      }
      case 'reorderItems': {
        const itemIds = action.items.map(itemIdOf);
        if (itemIds.some((id) => !id) || new Set(itemIds).size !== state.itemOrder.length) {
          return { kind: 'invalid', reason: '並べ替えには、すべての商品を一度ずつ指定する必要があります。' };
        }
        ops.push({ type: 'reorderItems', itemIds: itemIds as string[], expectedOrder: state.itemOrder });
        break;
      }
      case 'setTheme': {
        const { tokens, accentAdjusted } = applyThemeChoice(themeTokens, {
          palette: action.palette,
          accent: action.accent,
          fontPreset: action.fontPreset,
          density: action.density,
          corners: action.corners,
          imageAspect: action.imageAspect,
        });
        themeTokens = tokens;
        ops.push({ type: 'setTheme', tokens, expectedRevision: state.theme.revision, accentAdjusted });
        break;
      }
      case 'requestPreview':
      case 'offerPublish':
        ops.push({ type: action.type });
        break;
    }
  }

  const touchedItems = new Set(ops.flatMap((op) => (op.type === 'updateItem' || op.type === 'removeItem' || op.type === 'createItem' ? [op.itemId] : [])));
  const needsApproval = ops.some((op) => op.type === 'removeItem') || touchedItems.size > CHAT_LIMITS.autoApplyMaxItems;
  return { kind: 'ok', ops, policy: needsApproval && ops.some(isMutation) ? 'proposed' : 'auto' };
}
