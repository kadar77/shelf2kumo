import {
  LIMITS,
  type CreateItemRequest,
  type CreateItemResponse,
  type ItemDoc,
  type ItemField,
  type ReorderItemsRequest,
  type UpdateItemRequest,
  type UpdateItemResponse,
} from '@shelf2kumo/contracts';
import { FieldValue, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';
import { HttpError, notFound } from '../api/http.ts';

export interface ItemService {
  create(ownerId: string, shopId: string, request: CreateItemRequest): Promise<CreateItemResponse>;
  update(ownerId: string, shopId: string, itemId: string, request: UpdateItemRequest): Promise<UpdateItemResponse>;
  remove(ownerId: string, shopId: string, itemId: string): Promise<void>;
  reorder(ownerId: string, shopId: string, request: ReorderItemsRequest): Promise<void>;
}

const ITEM_FIELDS: ItemField[] = ['name', 'description', 'category', 'priceJpy', 'taxTreatment'];

export const catalogFull = () =>
  new HttpError(409, 'conflict', `商品は 1 店舗あたり ${LIMITS.itemsPerShop} 件までです。不要な商品を削除してください。`);

/** Reads the shop in a transaction and checks ownership; returns its current contentRevision. */
async function ownedShop(tx: Transaction, shopRef: DocumentReference, ownerId: string): Promise<number> {
  const shop = await tx.get(shopRef);
  if (!shop.exists || shop.get('ownerId') !== ownerId) throw notFound();
  return Number(shop.get('contentRevision') ?? 0);
}

/** Every catalog mutation bumps the aggregate revision without an expected-value check (spec §6). */
function bumpContent(tx: Transaction, shopRef: DocumentReference, current: number) {
  tx.update(shopRef, { contentRevision: current + 1, updatedAt: FieldValue.serverTimestamp() });
}

async function assertUsableImage(tx: Transaction, db: Firestore, shopId: string, ownerId: string, imageId: string) {
  const image = await tx.get(db.doc(`shops/${shopId}/images/${imageId}`));
  if (!image.exists || image.get('ownerId') !== ownerId || image.get('state') !== 'processed') {
    throw new HttpError(400, 'bad_request', '選んだ写真は使えません。別の写真を選んでください。');
  }
}

export function firestoreItemService(db: Firestore): ItemService {
  return {
    async create(ownerId, shopId, request) {
      const shopRef = db.doc(`shops/${shopId}`);
      const itemRef = db.collection(`shops/${shopId}/items`).doc();
      await db.runTransaction(async (tx) => {
        const contentRevision = await ownedShop(tx, shopRef, ownerId);
        const count = (await tx.get(db.collection(`shops/${shopId}/items`).count())).data().count;
        if (count >= LIMITS.itemsPerShop) throw catalogFull();
        if (request.imageId) await assertUsableImage(tx, db, shopId, ownerId, request.imageId);

        const item: ItemDoc = {
          name: request.name ?? null,
          description: request.description ?? null,
          category: request.category ?? null,
          priceJpy: request.priceJpy ?? null,
          currency: 'JPY',
          taxTreatment: request.taxTreatment ?? 'unknown',
          imageId: request.imageId ?? null,
          order: Date.now(),
          revision: 0,
          sourceJobId: null,
          uncertainFields: [],
        };
        tx.create(itemRef, { ...item, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        bumpContent(tx, shopRef, contentRevision);
      });
      return { itemId: itemRef.id };
    },

    async update(ownerId, shopId, itemId, request) {
      const shopRef = db.doc(`shops/${shopId}`);
      const itemRef = db.doc(`shops/${shopId}/items/${itemId}`);
      return db.runTransaction(async (tx) => {
        const contentRevision = await ownedShop(tx, shopRef, ownerId);
        const snapshot = await tx.get(itemRef);
        const item = snapshot.data() as ItemDoc | undefined;
        if (!item) throw notFound();
        if (item.revision !== request.expectedRevision) {
          throw new HttpError(409, 'revision_conflict', 'この商品は別の画面で変更されました。最新の内容を確認してから保存してください。');
        }
        if (request.changes.imageId) await assertUsableImage(tx, db, shopId, ownerId, request.changes.imageId);

        const changes = Object.fromEntries(Object.entries(request.changes).filter(([, value]) => value !== undefined));
        // An owner edit confirms the field; drop its "uncertain" flag.
        const uncertainFields = (item.uncertainFields ?? []).filter((field) => !(field in changes) || !ITEM_FIELDS.includes(field));
        const revision = item.revision + 1;
        tx.update(itemRef, { ...changes, uncertainFields, revision, updatedAt: FieldValue.serverTimestamp() });
        bumpContent(tx, shopRef, contentRevision);
        return { revision };
      });
    },

    async remove(ownerId, shopId, itemId) {
      const shopRef = db.doc(`shops/${shopId}`);
      const itemRef = db.doc(`shops/${shopId}/items/${itemId}`);
      await db.runTransaction(async (tx) => {
        const contentRevision = await ownedShop(tx, shopRef, ownerId);
        if (!(await tx.get(itemRef)).exists) throw notFound();
        // The live release is immutable; removal appears in the next publish summary.
        tx.delete(itemRef);
        bumpContent(tx, shopRef, contentRevision);
      });
    },

    async reorder(ownerId, shopId, request) {
      const shopRef = db.doc(`shops/${shopId}`);
      await db.runTransaction(async (tx) => {
        const contentRevision = await ownedShop(tx, shopRef, ownerId);
        const items = await tx.get(db.collection(`shops/${shopId}/items`));
        const existing = new Set(items.docs.map((doc) => doc.id));
        const requested = new Set(request.itemIds);
        if (requested.size !== request.itemIds.length || requested.size !== existing.size || [...requested].some((id) => !existing.has(id))) {
          throw new HttpError(409, 'revision_conflict', '商品一覧が変更されました。最新の一覧で並べ替えてください。');
        }
        request.itemIds.forEach((id, index) => {
          tx.update(db.doc(`shops/${shopId}/items/${id}`), { order: index, updatedAt: FieldValue.serverTimestamp() });
        });
        bumpContent(tx, shopRef, contentRevision);
      });
    },
  };
}
