import {
  LIMITS,
  StorefrontSnapshot,
  draftItemsForSnapshot,
  snapshotByteSize,
  toStorefrontSnapshot,
  type ChangeSummary,
  type ItemDoc,
  type ShopDoc,
  type SnapshotImageInfo,
} from '@shelf2kumo/contracts';
import type { DocumentReference, DocumentSnapshot, Firestore, Query, QuerySnapshot, Transaction } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { themeFrom, themeRef } from '../chat/apply.ts';

/** Reads either inside a transaction or directly, so prepare and publish build identical drafts. */
export interface Reader {
  doc(ref: DocumentReference): Promise<DocumentSnapshot>;
  query(query: Query): Promise<QuerySnapshot>;
}

export const directReader: Reader = { doc: (ref) => ref.get(), query: (query) => query.get() };
export const txReader = (tx: Transaction): Reader => ({ doc: (ref) => tx.get(ref), query: (query) => tx.get(query) });

export interface Draft {
  shop: ShopDoc;
  snapshot: StorefrontSnapshot;
  /** contentHash → private rendition path; server-only, used by the /media route. */
  media: Record<string, string>;
  hash: string;
  unnamedItems: number;
}

/** JSON with object keys sorted at every level, so the hash never depends on Firestore field order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export const snapshotHash = (snapshot: StorefrontSnapshot) => createHash('sha256').update(canonicalJson(snapshot)).digest('hex');

/**
 * Builds the public snapshot from saved draft data with the same mapping as the workspace preview,
 * then validates it against the public-field allowlist (spec §6).
 */
export async function buildDraft(read: Reader, db: Firestore, shopId: string): Promise<Draft> {
  const shopSnapshot = await read.doc(db.doc(`shops/${shopId}`));
  const shop = shopSnapshot.data() as ShopDoc;
  const itemsSnapshot = await read.query(db.collection(`shops/${shopId}/items`));
  const items = itemsSnapshot.docs.map((doc) => ({ ...(doc.data() as ItemDoc), id: doc.id }));
  const imageIds = [...new Set(items.flatMap((item) => (item.imageId ? [item.imageId] : [])))];
  const images = await Promise.all(imageIds.map((id) => read.doc(db.doc(`shops/${shopId}/images/${id}`))));
  const theme = themeFrom(await read.doc(themeRef(db, shopId)));

  const imageInfo = new Map<string, SnapshotImageInfo>();
  const media: Record<string, string> = {};
  for (const image of images) {
    const data = image.data();
    if (data?.state === 'processed' && data.contentHash && data.renditionPath && data.width && data.height) {
      imageInfo.set(image.id, { contentHash: data.contentHash, width: data.width, height: data.height });
      media[data.contentHash] = data.renditionPath;
    }
  }

  const snapshot = StorefrontSnapshot.parse(toStorefrontSnapshot({ shop, items: draftItemsForSnapshot(items, imageInfo), theme: theme.tokens }));
  if (snapshotByteSize(snapshot) >= LIMITS.snapshotMaxBytes) throw new Error('Snapshot too large');
  const referenced = new Set(snapshot.items.flatMap((item) => (item.image ? [item.image.contentHash] : [])));
  for (const hash of Object.keys(media)) if (!referenced.has(hash)) delete media[hash];

  return { shop, snapshot, media, hash: snapshotHash(snapshot), unnamedItems: items.filter((item) => !item.name).length };
}

const ITEM_FIELDS = ['name', 'description', 'category', 'priceJpy', 'taxTreatment'] as const;
const PROFILE_FIELDS = ['name', 'description', 'address', 'phone', 'hours', 'mapUrl'] as const;

/** Compares the draft with the live release for the owner's confirmation (spec §9). */
export function summarizeChanges(draft: StorefrontSnapshot, live: StorefrontSnapshot | null): ChangeSummary {
  if (!live) {
    return {
      firstPublication: true,
      itemCount: draft.items.length,
      added: draft.items.map((item) => item.name),
      removed: [],
      changed: [],
      profileFields: [],
      themeChanged: false,
      orderChanged: false,
      noChanges: false,
    };
  }
  const liveItems = new Map(live.items.map((item) => [item.id, item]));
  const draftIds = new Set(draft.items.map((item) => item.id));
  const added = draft.items.filter((item) => !liveItems.has(item.id)).map((item) => item.name);
  const removed = live.items.filter((item) => !draftIds.has(item.id)).map((item) => item.name);
  const changed = draft.items.flatMap((item) => {
    const before = liveItems.get(item.id);
    if (!before) return [];
    const fields: string[] = ITEM_FIELDS.filter((field) => before[field] !== item[field]);
    if ((before.image?.contentHash ?? null) !== (item.image?.contentHash ?? null)) fields.push('image');
    return fields.length > 0 ? [{ name: item.name, fields }] : [];
  });
  const profileFields = PROFILE_FIELDS.filter((field) => live.shop[field] !== draft.shop[field]);
  const themeChanged = canonicalJson(live.theme) !== canonicalJson(draft.theme);
  const common = (ids: string[]) => ids.filter((id) => draftIds.has(id) && liveItems.has(id));
  const orderChanged = common(live.items.map((item) => item.id)).join('|') !== common(draft.items.map((item) => item.id)).join('|');
  const noChanges = added.length + removed.length + changed.length + profileFields.length === 0 && !themeChanged && !orderChanged;
  return { firstPublication: false, itemCount: draft.items.length, added, removed, changed, profileFields, themeChanged, orderChanged, noChanges };
}
