import type {
  AllocateUploadResponse,
  CreateExtractionResponse,
  ImageDoc,
  ImageRejectReason,
  ImageState,
  ProcessImageResponse,
} from '@shelf2kumo/contracts';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { getBlob, ref, uploadBytes } from 'firebase/storage';
import { useEffect, useState } from 'react';
import { apiFetch } from '../api.ts';
import { db } from '../firestore.ts';
import { storage } from '../storage.ts';
import { prepareUpload } from './prepareUpload.ts';

export type ImageWithId = ImageDoc & { id: string };

const IMAGE_STATES = new Set<ImageState>(['allocated', 'processed', 'rejected']);

/** Live list of a shop's recent photos (owner-readable via Firestore rules). */
export function useShopImages(shopId: string): ImageWithId[] {
  const [images, setImages] = useState<ImageWithId[]>([]);
  useEffect(
    () =>
      onSnapshot(query(collection(db, 'shops', shopId, 'images'), orderBy('createdAt', 'desc')), (snapshot) =>
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

/** Object URLs for private renditions, shared by thumbnails and the preview (fetched once per path). */
const renditionCache = new Map<string, Promise<string>>();

function renditionObjectUrl(path: string): Promise<string> {
  let pending = renditionCache.get(path);
  if (!pending) {
    pending = getBlob(ref(storage, path)).then((blob) => URL.createObjectURL(blob));
    pending.catch(() => renditionCache.delete(path));
    renditionCache.set(path, pending);
  }
  return pending;
}

/** Fetches a private rendition with the signed-in user's credentials; never a public download URL. */
export function useRenditionUrl(path: string | null): string | null {
  const urls = useRenditionUrls(path ? [path] : []);
  return path ? (urls.get(path) ?? null) : null;
}

/** Map of rendition path → object URL for the given paths (missing until loaded). */
export function useRenditionUrls(paths: string[]): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const key = [...new Set(paths)].sort().join('|');
  useEffect(() => {
    let cancelled = false;
    for (const path of key ? key.split('|') : []) {
      renditionObjectUrl(path)
        .then((url) => {
          if (!cancelled) setUrls((current) => (current.get(path) === url ? current : new Map(current).set(path, url)));
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [key]);
  return urls;
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

export function requestExtraction(shopId: string, imageId: string, retryOfJobId?: string): Promise<CreateExtractionResponse> {
  return apiFetch<CreateExtractionResponse>('POST', `/api/shops/${shopId}/extractions`, retryOfJobId ? { imageId, retryOfJobId } : { imageId });
}
