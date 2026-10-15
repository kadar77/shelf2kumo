import { getStorage } from 'firebase-admin/storage';

/** The private Storage operations the image service needs (admin access; bypasses rules). */
export interface ObjectStore {
  stat(path: string): Promise<{ size: number; contentType: string | null } | null>;
  read(path: string): Promise<Buffer>;
  write(path: string, data: Buffer, contentType: string): Promise<void>;
  remove(path: string): Promise<void>;
}

/** Default bucket of the project (FIREBASE_CONFIG.storageBucket in Functions and the emulator). */
export function firebaseObjectStore(): ObjectStore {
  const bucket = () => getStorage().bucket();
  return {
    async stat(path) {
      const file = bucket().file(path);
      const [exists] = await file.exists();
      if (!exists) return null;
      const [metadata] = await file.getMetadata();
      return { size: Number(metadata.size ?? 0), contentType: metadata.contentType ?? null };
    },
    async read(path) {
      const [data] = await bucket().file(path).download();
      return data;
    },
    async write(path, data, contentType) {
      // Private object; no download token metadata, so no durable public URL exists.
      await bucket().file(path).save(data, { contentType, resumable: false, metadata: { cacheControl: 'private, max-age=0' } });
    },
    async remove(path) {
      await bucket().file(path).delete({ ignoreNotFound: true });
    },
  };
}
