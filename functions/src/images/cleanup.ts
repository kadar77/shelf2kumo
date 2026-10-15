import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { ObjectStore } from './store.ts';

/** Allocations never uploaded/processed, and rejected uploads, are removed after this age (spec §6). */
export const ABANDONED_UPLOAD_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Deletes stale `allocated` and `rejected` image records and their Storage objects. Processed images
 * are never touched here; they may be referenced by items or releases.
 */
export async function cleanupAbandonedUploads(db: Firestore, store: ObjectStore, now = Date.now()): Promise<number> {
  const cutoff = Timestamp.fromMillis(now - ABANDONED_UPLOAD_AGE_MS);
  const stale = await db
    .collectionGroup('images')
    .where('state', 'in', ['allocated', 'rejected'])
    .where('createdAt', '<', cutoff)
    .limit(500)
    .get();

  for (const doc of stale.docs) {
    const uploadPath = doc.get('uploadPath');
    if (typeof uploadPath === 'string') await store.remove(uploadPath);
    await doc.ref.delete();
  }
  return stale.size;
}
