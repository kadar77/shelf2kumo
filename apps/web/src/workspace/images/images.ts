import type {
  AllocateUploadResponse,
  ImageDoc,
  ImageRejectReason,
  ImageState,
  ProcessImageResponse,
} from '@shelf2kumo/contracts';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { getBlob, ref, uploadBytes } from 'firebase/storage';
import { useEffect, useState } from 'react';
import { apiFetch } from '../api.ts';
import { db, storage } from '../firebase.ts';
import { prepareUpload } from './prepareUpload.ts';

export type ImageWithId = ImageDoc & { id: string };

const IMAGE_STATES = new Set<ImageState>(['allocated', 'processed', 'rejected']);

/** Live list of a shop's recent photos (owner-readable via Firestore rules). */
export function useShopImages(shopId: string): ImageWithId[] {
  const [images, setImages] = useState<ImageWithId[]>([]);
  useEffect(
    () =>
      onSnapshot(query(collection(db, 'shops', shopId, 'images'), orderBy('createdAt', 'desc'), limit(50)), (snapshot) =>
        setImages(
          snapshot.docs.map((d) => {
            const data = d.data();
            return {
              id: d.id,
              ownerId: String(data.ownerId ?? ''),
              state: IMAGE_STATES.has(data.state) ? data.state : 'allocated',
              uploadPath: String(data.uploadPath ?? ''),
              renditionPath: typeof data.renditionPath === 'string' ? data.renditionPath : null,
              width: typeof data.width === 'number' ? data.width : null,
              height: typeof data.height === 'number' ? data.height : null,
              contentHash: typeof data.contentHash === 'string' ? data.contentHash : null,
              rejectReason: typeof data.rejectReason === 'string' ? (data.rejectReason as ImageRejectReason) : null,
            };
          }),
        ),
      ),
    [shopId],
  );
  return images;
}

/** Fetches a private rendition with the signed-in user's credentials; never a public download URL. */
export function useRenditionUrl(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!path) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    getBlob(ref(storage, path))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);
  return path ? url : null;
}

export type UploadStage = 'preparing' | 'uploading' | 'processing';

/** Resize → allocate → private upload → server validation/rendition. Throws with a Japanese message. */
export async function uploadPhoto(shopId: string, file: File, onStage: (stage: UploadStage) => void): Promise<ProcessImageResponse> {
  onStage('preparing');
  const { blob, contentType } = await prepareUpload(file);
  const { imageId, uploadPath } = await apiFetch<AllocateUploadResponse>('POST', `/api/shops/${shopId}/uploads`, {
    contentType,
    bytes: blob.size,
  });
  onStage('uploading');
  await uploadBytes(ref(storage, uploadPath), blob, { contentType });
  onStage('processing');
  return apiFetch<ProcessImageResponse>('POST', `/api/shops/${shopId}/images/${imageId}/process`, {});
}
