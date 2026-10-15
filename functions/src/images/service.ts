import {
  IMAGE_LIMITS,
  IMAGE_REJECT_MESSAGES,
  type AllocateUploadRequest,
  type AllocateUploadResponse,
  type ImageDoc,
  type ImageRejectReason,
  type ProcessImageResponse,
} from '@shelf2kumo/contracts';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { HttpError, notFound } from '../api/http.ts';
import { renderImage } from './render.ts';
import type { ObjectStore } from './store.ts';

export interface ImageService {
  allocate(ownerId: string, shopId: string, request: AllocateUploadRequest): Promise<AllocateUploadResponse>;
  process(ownerId: string, shopId: string, imageId: string): Promise<ProcessImageResponse>;
}

export const uploadPathFor = (ownerId: string, shopId: string, imageId: string) => `owners/${ownerId}/shops/${shopId}/uploads/${imageId}`;
export const renditionPathFor = (ownerId: string, shopId: string, imageId: string) =>
  `owners/${ownerId}/shops/${shopId}/renditions/${imageId}.jpg`;

const rejected = (reason: ImageRejectReason) => new HttpError(400, 'image_rejected', IMAGE_REJECT_MESSAGES[reason]);

export function firestoreImageService(db: Firestore, store: ObjectStore): ImageService {
  return {
    async allocate(ownerId, shopId, request) {
      const shop = await db.doc(`shops/${shopId}`).get();
      if (!shop.exists || shop.get('ownerId') !== ownerId) throw notFound();

      const images = db.collection(`shops/${shopId}/images`);
      const count = await images.count().get();
      if (count.data().count >= IMAGE_LIMITS.maxImagesPerShop) {
        throw new HttpError(429, 'quota_exceeded', `写真は 1 店舗あたり ${IMAGE_LIMITS.maxImagesPerShop} 枚までです。`);
      }

      const ref = images.doc();
      const uploadPath = uploadPathFor(ownerId, shopId, ref.id);
      const image: ImageDoc = {
        ownerId,
        state: 'allocated',
        uploadPath,
        renditionPath: null,
        width: null,
        height: null,
        contentHash: null,
        rejectReason: null,
      };
      await ref.create({
        ...image,
        claimedContentType: request.contentType,
        claimedBytes: request.bytes,
        createdAt: FieldValue.serverTimestamp(),
      });
      return { imageId: ref.id, uploadPath };
    },

    async process(ownerId, shopId, imageId) {
      const ref = db.doc(`shops/${shopId}/images/${imageId}`);
      const snapshot = await ref.get();
      const image = snapshot.data() as ImageDoc | undefined;
      if (!image || image.ownerId !== ownerId) throw notFound();

      if (image.state === 'processed' && image.width && image.height && image.contentHash) {
        return { imageId, state: 'processed', width: image.width, height: image.height, contentHash: image.contentHash };
      }
      if (image.state === 'rejected') throw rejected(image.rejectReason ?? 'corrupt');

      const object = await store.stat(image.uploadPath);
      // Not uploaded (yet): leave the allocation in place so the client can retry the upload.
      if (!object) throw rejected('missing');

      const reject = async (reason: ImageRejectReason) => {
        await store.remove(image.uploadPath);
        await ref.update({ state: 'rejected', rejectReason: reason, processedAt: FieldValue.serverTimestamp() });
        return rejected(reason);
      };

      if (object.size > IMAGE_LIMITS.maxUploadBytes) throw await reject('too_large');
      const result = await renderImage(await store.read(image.uploadPath));
      if (!result.ok) throw await reject(result.reason);

      const renditionPath = renditionPathFor(ownerId, shopId, imageId);
      await store.write(renditionPath, result.rendition, 'image/jpeg');
      await ref.update({
        state: 'processed',
        renditionPath,
        width: result.width,
        height: result.height,
        contentHash: result.contentHash,
        renditionBytes: result.rendition.length,
        sourceFormat: result.sourceFormat,
        processedAt: FieldValue.serverTimestamp(),
      });
      return { imageId, state: 'processed', width: result.width, height: result.height, contentHash: result.contentHash };
    },
  };
}
