import {
  CONFIRMATION_TTL_MS,
  StorefrontSnapshot,
  type PreparePublicationResponse,
  type PublishRequest,
  type PublishResponse,
} from '@shelf2kumo/contracts';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { HttpError, notFound } from '../api/http.ts';
import { buildDraft, directReader, summarizeChanges, txReader } from './snapshot.ts';

export interface PublishingService {
  prepare(ownerId: string, shopId: string): Promise<PreparePublicationResponse>;
  publish(ownerId: string, shopId: string, request: PublishRequest): Promise<PublishResponse>;
  unpublish(ownerId: string, shopId: string): Promise<void>;
}

const stale = () =>
  new HttpError(409, 'revision_conflict', '公開内容の確認後に変更がありました。最新の変更内容を確認してから公開してください。');

export function firestorePublishingService(db: Firestore, origin: () => string, now: () => number = Date.now): PublishingService {
  const urlFor = (slug: string) => `${origin().replace(/\/+$/, '')}/s/${slug}`;

  return {
    async prepare(ownerId, shopId) {
      const shop = await db.doc(`shops/${shopId}`).get();
      if (!shop.exists || shop.get('ownerId') !== ownerId) throw notFound();

      const pending = await db.collection(`shops/${shopId}/jobs`).where('state', 'in', ['queued', 'running']).limit(1).get();
      if (!pending.empty) {
        throw new HttpError(409, 'conflict', '写真の読み取りが終わるまでお待ちください。読み取り中の商品は公開内容に含まれません。');
      }

      let draft;
      try {
        draft = await buildDraft(directReader, db, shopId);
      } catch {
        throw new HttpError(409, 'conflict', '公開できない内容が含まれています。商品名や説明の長さを確認してください。');
      }
      if (draft.unnamedItems > 0) {
        throw new HttpError(409, 'conflict', `商品名が未入力の商品が ${draft.unnamedItems} 件あります。公開する前に商品名を入力するか、商品を削除してください。`);
      }

      const liveReleaseId = shop.get('liveReleaseId');
      const live = typeof liveReleaseId === 'string' ? (await db.doc(`shops/${shopId}/releases/${liveReleaseId}`).get()).get('snapshot') : null;
      const summary = summarizeChanges(draft.snapshot, live ? StorefrontSnapshot.parse(live) : null);

      const expiresAt = Timestamp.fromMillis(now() + CONFIRMATION_TTL_MS);
      const confirmation = db.collection(`shops/${shopId}/publishConfirmations`).doc();
      await confirmation.create({
        ownerId,
        contentRevision: Number(shop.get('contentRevision') ?? 0),
        snapshotHash: draft.hash,
        summary,
        expiresAt,
        usedAt: null,
        createdAt: FieldValue.serverTimestamp(),
      });
      return {
        confirmationId: confirmation.id,
        snapshotHash: draft.hash,
        summary,
        expiresAt: expiresAt.toDate().toISOString(),
        url: urlFor(draft.snapshot.shop.slug),
      };
    },

    async publish(ownerId, shopId, request) {
      return db.runTransaction(async (tx) => {
        const confirmationRef = db.doc(`shops/${shopId}/publishConfirmations/${request.confirmationId}`);
        const confirmation = await tx.get(confirmationRef);
        const shopRef = db.doc(`shops/${shopId}`);
        const shop = await tx.get(shopRef);
        if (!shop.exists || shop.get('ownerId') !== ownerId || !confirmation.exists || confirmation.get('ownerId') !== ownerId) throw notFound();
        if (confirmation.get('usedAt')) throw new HttpError(409, 'conflict', 'この確認はすでに使用されています。もう一度「公開する」を押してください。');
        if ((confirmation.get('expiresAt') as Timestamp).toMillis() <= now()) {
          throw new HttpError(409, 'conflict', '確認の有効期限が切れました。もう一度「公開する」を押してください。');
        }
        if (confirmation.get('snapshotHash') !== request.snapshotHash) throw stale();
        if (Number(shop.get('contentRevision') ?? 0) !== confirmation.get('contentRevision')) throw stale();

        // Rebuild inside the transaction: exactly the content the owner confirmed, or nothing.
        const draft = await buildDraft(txReader(tx), db, shopId);
        if (draft.hash !== request.snapshotHash || draft.unnamedItems > 0) throw stale();
        const slug = draft.snapshot.shop.slug;
        const pointerRef = db.doc(`publishedCatalogs/${slug}`);
        const pointer = await tx.get(pointerRef);
        if (pointer.exists && pointer.get('shopId') !== shopId) throw new HttpError(409, 'slug_unavailable', 'この URL は使用できません。');

        const releaseRef = db.collection(`shops/${shopId}/releases`).doc();
        tx.create(releaseRef, {
          ownerId,
          snapshot: draft.snapshot,
          media: draft.media,
          hash: draft.hash,
          contentRevision: confirmation.get('contentRevision'),
          confirmationId: confirmation.id,
          createdAt: FieldValue.serverTimestamp(),
        });
        tx.set(pointerRef, { shopId, releaseId: releaseRef.id, isDemo: draft.snapshot.shop.isDemo, publishedAt: FieldValue.serverTimestamp() });
        tx.update(shopRef, {
          liveReleaseId: releaseRef.id,
          publishedRevision: confirmation.get('contentRevision'),
          slugLocked: true,
          lastPublishedAt: FieldValue.serverTimestamp(),
        });
        tx.update(confirmationRef, { usedAt: FieldValue.serverTimestamp(), releaseId: releaseRef.id });
        return { releaseId: releaseRef.id, url: urlFor(slug) };
      });
    },

    async unpublish(ownerId, shopId) {
      await db.runTransaction(async (tx) => {
        const shopRef = db.doc(`shops/${shopId}`);
        const shop = await tx.get(shopRef);
        if (!shop.exists || shop.get('ownerId') !== ownerId) throw notFound();
        const pointerRef = db.doc(`publishedCatalogs/${shop.get('slug')}`);
        const pointer = await tx.get(pointerRef);
        if (pointer.exists && pointer.get('shopId') === shopId) tx.delete(pointerRef);
        // Releases are kept for recovery; only the live pointer goes away (idempotent).
        tx.update(shopRef, { liveReleaseId: null, publishedRevision: null, unpublishedAt: FieldValue.serverTimestamp() });
      });
    },
  };
}
