import { LIMITS, type FieldDiff, type ItemDoc, type ThemeTokens } from '@shelf2kumo/contracts';
import { PRESETS } from '@shelf2kumo/themes';
import { FieldValue, type DocumentSnapshot, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { ApplyConflict, type AppliedRecord, type ItemFields, type ProfileFields, type ResolvedOp } from './ops.ts';

const PROFILE_KEYS = ['name', 'description', 'hours', 'address', 'phone'] as const;
const ITEM_KEYS = ['name', 'description', 'category', 'priceJpy', 'taxTreatment'] as const;

export const themeRef = (db: Firestore, shopId: string) => db.doc(`shops/${shopId}/theme/current`);

/** Current theme document or the Modern preset (revision 0) when none was saved yet. */
export function themeFrom(snapshot: DocumentSnapshot): { tokens: ThemeTokens; revision: number } {
  if (!snapshot.exists) return { tokens: PRESETS.modern, revision: 0 };
  const data = snapshot.data() as { tokens: ThemeTokens; revision?: number };
  return { tokens: data.tokens, revision: Number(data.revision ?? 0) };
}

const diffsOf = (before: Record<string, unknown>, after: Record<string, unknown>, keys: readonly string[]): FieldDiff[] =>
  keys
    .filter((key) => key in after && before[key] !== after[key])
    .map((key) => ({ field: key, before: (before[key] ?? null) as FieldDiff['before'], after: (after[key] ?? null) as FieldDiff['after'] }));

const pick = (source: Record<string, unknown>, keys: readonly string[]) =>
  Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key] ?? null]));

const changed = 'この内容は別の操作で変更されました。最新の状態でもう一度お試しください。';

/**
 * Applies a batch of resolved operations atomically inside the caller's transaction. All reads
 * happen first; any stale revision, missing target, or limit violation throws ApplyConflict and
 * nothing is written (spec §8 batches). Bumps contentRevision once per mutating batch.
 */
export async function applyOps(tx: Transaction, db: Firestore, shopId: string, ownerId: string, ops: ResolvedOp[]): Promise<AppliedRecord[]> {
  const shopRef = db.doc(`shops/${shopId}`);
  const itemsCol = db.collection(`shops/${shopId}/items`);

  // ---- Reads ----
  const shop = await tx.get(shopRef);
  if (!shop.exists || shop.get('ownerId') !== ownerId) throw new ApplyConflict('ショップが見つかりませんでした。');
  const needsAllItems = ops.some((op) => op.type === 'reorderItems' || op.type === 'createItem' || op.type === 'restoreItem');
  const itemIds = new Set(ops.flatMap((op) => ('itemId' in op ? [op.itemId] : [])));
  const items = new Map<string, ItemDoc | null>();
  if (needsAllItems) {
    for (const doc of (await tx.get(itemsCol)).docs) items.set(doc.id, doc.data() as ItemDoc);
    for (const id of itemIds) if (!items.has(id)) items.set(id, null);
  } else {
    for (const id of itemIds) {
      const doc = await tx.get(itemsCol.doc(id));
      items.set(id, doc.exists ? (doc.data() as ItemDoc) : null);
    }
  }
  const themeSnapshot = ops.some((op) => op.type === 'setTheme') ? await tx.get(themeRef(db, shopId)) : null;

  // ---- Validate and compute (in memory, sequentially) ----
  let profile: Record<string, unknown> = { ...shop.data(), profileRevision: Number(shop.get('profileRevision') ?? 0) };
  let theme = themeSnapshot ? themeFrom(themeSnapshot) : null;
  const checked = new Set<string>();
  const records: AppliedRecord[] = [];
  const writes: Array<() => void> = [];
  const now = Date.now();

  for (const op of ops) {
    switch (op.type) {
      case 'updateProfile': {
        if (!checked.has('profile') && profile.profileRevision !== op.expectedRevision) throw new ApplyConflict(changed);
        checked.add('profile');
        const before = pick(profile, PROFILE_KEYS);
        const next = { ...profile, ...op.changes, profileRevision: Number(profile.profileRevision) + 1 };
        records.push({
          op,
          label: '店舗情報',
          diffs: diffsOf(before, op.changes as ProfileFields, PROFILE_KEYS),
          before: pick(before, Object.keys(op.changes)),
          after: { ...op.changes },
          afterRevision: Number(next.profileRevision),
          undoable: true,
        });
        profile = next;
        break;
      }
      case 'updateItem': {
        const item = items.get(op.itemId);
        if (!item) throw new ApplyConflict('対象の商品が見つかりませんでした。');
        if (!checked.has(op.itemId) && item.revision !== op.expectedRevision) throw new ApplyConflict(changed);
        checked.add(op.itemId);
        const next: ItemDoc = {
          ...item,
          ...(op.changes as ItemFields),
          revision: item.revision + 1,
          uncertainFields: (item.uncertainFields ?? []).filter((field) => !(field in op.changes)),
        };
        items.set(op.itemId, next);
        records.push({
          op,
          label: next.name ?? item.name ?? '商品',
          diffs: diffsOf(item as unknown as Record<string, unknown>, op.changes, ITEM_KEYS),
          before: pick(item as unknown as Record<string, unknown>, Object.keys(op.changes)),
          after: { ...op.changes },
          afterRevision: next.revision,
          undoable: true,
        });
        break;
      }
      case 'createItem': {
        if (items.get(op.itemId)) throw new ApplyConflict(changed);
        const count = [...items.values()].filter(Boolean).length;
        if (count >= LIMITS.itemsPerShop) throw new ApplyConflict(`商品は 1 店舗あたり ${LIMITS.itemsPerShop} 件までです。`);
        const item: ItemDoc = {
          name: op.fields.name ?? null,
          description: op.fields.description ?? null,
          category: op.fields.category ?? null,
          priceJpy: op.fields.priceJpy ?? null,
          currency: 'JPY',
          taxTreatment: op.fields.taxTreatment ?? 'unknown',
          imageId: null,
          order: now + records.length,
          revision: 0,
          sourceJobId: null,
          uncertainFields: [],
        };
        items.set(op.itemId, item);
        records.push({ op, label: item.name ?? '新しい商品', diffs: diffsOf({}, op.fields, ITEM_KEYS), before: null, after: { ...item }, afterRevision: 0, undoable: true });
        break;
      }
      case 'restoreItem': {
        if (items.get(op.itemId)) throw new ApplyConflict(changed);
        const item = { ...op.item, revision: op.item.revision + 1 };
        items.set(op.itemId, item);
        records.push({ op, label: item.name ?? '商品', diffs: [], before: null, after: { ...item }, afterRevision: item.revision, undoable: false });
        break;
      }
      case 'removeItem': {
        const item = items.get(op.itemId);
        if (!item) throw new ApplyConflict('対象の商品が見つかりませんでした。');
        if (!checked.has(op.itemId) && item.revision !== op.expectedRevision) throw new ApplyConflict(changed);
        checked.add(op.itemId);
        items.set(op.itemId, null);
        records.push({ op, label: item.name ?? '商品', diffs: [], before: { ...item }, after: null, afterRevision: null, undoable: true });
        break;
      }
      case 'reorderItems': {
        const current = [...items.entries()].filter((entry): entry is [string, ItemDoc] => entry[1] !== null);
        const currentOrder = current.sort((a, b) => a[1].order - b[1].order).map(([id]) => id);
        if (currentOrder.join('|') !== op.expectedOrder.join('|')) throw new ApplyConflict(changed);
        if (new Set(op.itemIds).size !== currentOrder.length || op.itemIds.some((id) => !items.get(id))) throw new ApplyConflict(changed);
        op.itemIds.forEach((id, index) => items.set(id, { ...(items.get(id) as ItemDoc), order: index }));
        records.push({ op, label: '並び順', diffs: [], before: { order: currentOrder }, after: { order: op.itemIds }, afterRevision: null, undoable: true });
        break;
      }
      case 'setTheme': {
        const currentTheme = theme as { tokens: ThemeTokens; revision: number };
        if (!checked.has('theme') && currentTheme.revision !== op.expectedRevision) throw new ApplyConflict(changed);
        checked.add('theme');
        const revision = currentTheme.revision + 1;
        records.push({
          op,
          label: 'テーマ',
          diffs: [],
          before: { tokens: currentTheme.tokens },
          after: { tokens: op.tokens },
          afterRevision: revision,
          undoable: true,
        });
        theme = { tokens: op.tokens, revision };
        break;
      }
      case 'requestPreview':
      case 'offerPublish':
        records.push({ op, label: op.type === 'requestPreview' ? 'プレビュー' : '公開', diffs: [], before: null, after: null, afterRevision: null, undoable: false });
        break;
    }
  }

  // ---- Writes ----
  const mutating = records.some((record) => record.op.type !== 'requestPreview' && record.op.type !== 'offerPublish');
  if (!mutating) return records;

  const created = new Set(ops.flatMap((op) => (op.type === 'createItem' || op.type === 'restoreItem' ? [op.itemId] : [])));
  const touched = new Set(itemIds);
  for (const op of ops) if (op.type === 'reorderItems') op.itemIds.forEach((id) => touched.add(id));
  for (const id of touched) {
    const item = items.get(id);
    const ref = itemsCol.doc(id);
    if (item === null) writes.push(() => tx.delete(ref));
    else if (item && created.has(id)) {
      writes.push(() => tx.set(ref, { ...item, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }));
    } else if (item) writes.push(() => tx.set(ref, { ...item, updatedAt: FieldValue.serverTimestamp() }, { merge: true }));
  }
  if (theme && checked.has('theme')) {
    const saved = theme;
    writes.push(() =>
      tx.set(themeRef(db, shopId), {
        templateId: saved.tokens.templateId,
        templateVersion: saved.tokens.templateVersion,
        tokens: saved.tokens,
        revision: saved.revision,
        updatedAt: FieldValue.serverTimestamp(),
      }),
    );
  }
  const profileUpdates = checked.has('profile')
    ? Object.fromEntries([...PROFILE_KEYS, 'profileRevision'].filter((key) => key in profile).map((key) => [key, profile[key] ?? null]))
    : {};
  writes.push(() =>
    tx.update(shopRef, {
      ...profileUpdates,
      contentRevision: Number(shop.get('contentRevision') ?? 0) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    }),
  );
  for (const write of writes) write();
  return records;
}
