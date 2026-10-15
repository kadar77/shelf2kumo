import {
  MAX_SHOPS_PER_OWNER,
  type CreateShopRequest,
  type CreateShopResponse,
  type ShopDoc,
  type UpdateShopRequest,
  type UpdateShopResponse,
} from '@shelf2kumo/contracts';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { HttpError, notFound } from '../api/http.ts';
import { isClaimableSlug, randomSlug } from './slug.ts';

export interface ShopService {
  create(ownerId: string, input: CreateShopRequest): Promise<CreateShopResponse>;
  update(ownerId: string, shopId: string, request: UpdateShopRequest): Promise<UpdateShopResponse>;
}

const SLUG_ATTEMPTS = 5;

const slugUnavailable = (message: string) => new HttpError(409, 'slug_unavailable', message);

export function firestoreShopService(db: Firestore): ShopService {
  return {
    async create(ownerId, input) {
      const owned = await db.collection('shops').where('ownerId', '==', ownerId).count().get();
      if (owned.data().count >= MAX_SHOPS_PER_OWNER) {
        throw new HttpError(429, 'quota_exceeded', `ショップは最大${MAX_SHOPS_PER_OWNER}件まで作成できます。`);
      }

      const shopRef = db.collection('shops').doc();
      for (let attempt = 0; attempt < SLUG_ATTEMPTS; attempt += 1) {
        const slug = randomSlug();
        if (!isClaimableSlug(slug)) continue;
        const reservationRef = db.doc(`slugReservations/${slug}`);
        const created = await db.runTransaction(async (tx) => {
          if ((await tx.get(reservationRef)).exists) return false;
          const shop: ShopDoc = {
            ownerId,
            slug,
            slugLocked: false,
            name: input.name,
            description: input.description ?? null,
            address: null,
            phone: null,
            hours: null,
            mapUrl: null,
            isDemo: false,
            profileRevision: 0,
            contentRevision: 0,
            liveReleaseId: null,
          };
          tx.create(reservationRef, { shopId: shopRef.id, createdAt: FieldValue.serverTimestamp() });
          tx.create(shopRef, { ...shop, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
          return true;
        });
        if (created) return { shopId: shopRef.id, slug };
      }
      throw new HttpError(503, 'internal', 'ショップを作成できませんでした。もう一度お試しください。', true);
    },

    async update(ownerId, shopId, request) {
      const shopRef = db.doc(`shops/${shopId}`);
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(shopRef);
        const shop = snapshot.data() as ShopDoc | undefined;
        // Non-owners get the same answer as a missing shop: no existence leak.
        if (!shop || shop.ownerId !== ownerId) throw notFound();
        if (shop.profileRevision !== request.expectedRevision) {
          throw new HttpError(409, 'revision_conflict', '別の画面で変更されました。最新の内容を確認してから保存してください。');
        }

        const { slug: requestedSlug, ...fields } = request.changes;
        let slug = shop.slug;
        if (requestedSlug !== undefined && requestedSlug !== shop.slug) {
          if (shop.slugLocked) throw slugUnavailable('公開後は URL を変更できません。');
          if (!isClaimableSlug(requestedSlug)) throw slugUnavailable('この URL は使用できません。');
          const newReservation = db.doc(`slugReservations/${requestedSlug}`);
          if ((await tx.get(newReservation)).exists) throw slugUnavailable('この URL はすでに使われています。');
          tx.create(newReservation, { shopId, createdAt: FieldValue.serverTimestamp() });
          tx.delete(db.doc(`slugReservations/${shop.slug}`));
          slug = requestedSlug;
        }

        const changed = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
        const profileRevision = shop.profileRevision + 1;
        tx.update(shopRef, {
          ...changed,
          slug,
          profileRevision,
          contentRevision: shop.contentRevision + 1,
          updatedAt: FieldValue.serverTimestamp(),
        });
        return { profileRevision, slug };
      });
    },
  };
}
