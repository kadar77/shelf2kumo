import { FieldValue, type Firestore, type Timestamp } from 'firebase-admin/firestore';

export interface ReleaseInfo {
  releaseId: string;
  createdAt: string | null;
  contentRevision: number | null;
  items: number;
  live: boolean;
}

/** Lists a shop's retained releases, newest first (operator tooling). */
export async function listReleases(db: Firestore, shopId: string): Promise<ReleaseInfo[]> {
  const shop = await db.doc(`shops/${shopId}`).get();
  if (!shop.exists) throw new Error(`Shop ${shopId} not found`);
  const releases = await db.collection(`shops/${shopId}/releases`).orderBy('createdAt', 'desc').get();
  return releases.docs.map((doc) => ({
    releaseId: doc.id,
    createdAt: (doc.get('createdAt') as Timestamp | undefined)?.toDate().toISOString() ?? null,
    contentRevision: doc.get('contentRevision') ?? null,
    items: Array.isArray(doc.get('snapshot.items')) ? doc.get('snapshot.items').length : 0,
    live: doc.id === shop.get('liveReleaseId'),
  }));
}

/**
 * Rolls one shop back to a previous immutable release by moving its live pointer (spec §10 Phase 6).
 * Other shops are untouched. Drafts are not modified; the owner's next publication replaces the
 * rolled-back release. Refuses releases of another shop or a slug owned by another shop.
 */
export async function rollbackToRelease(db: Firestore, shopId: string, releaseId: string): Promise<{ slug: string }> {
  return db.runTransaction(async (tx) => {
    const shopRef = db.doc(`shops/${shopId}`);
    const shop = await tx.get(shopRef);
    if (!shop.exists) throw new Error(`Shop ${shopId} not found`);
    const release = await tx.get(db.doc(`shops/${shopId}/releases/${releaseId}`));
    if (!release.exists) throw new Error(`Release ${releaseId} not found for shop ${shopId}`);
    const slug = String(shop.get('slug'));
    const snapshotSlug = release.get('snapshot.shop.slug');
    if (snapshotSlug !== slug) throw new Error(`Release slug ${snapshotSlug} does not match shop slug ${slug}`);
    const pointerRef = db.doc(`publishedCatalogs/${slug}`);
    const pointer = await tx.get(pointerRef);
    if (pointer.exists && pointer.get('shopId') !== shopId) throw new Error(`Slug ${slug} is owned by another shop`);

    tx.set(pointerRef, {
      shopId,
      releaseId,
      isDemo: release.get('snapshot.shop.isDemo') === true,
      publishedAt: FieldValue.serverTimestamp(),
      rolledBackAt: FieldValue.serverTimestamp(),
    });
    tx.update(shopRef, {
      liveReleaseId: releaseId,
      publishedRevision: release.get('contentRevision') ?? null,
      slugLocked: true,
      lastRollbackAt: FieldValue.serverTimestamp(),
    });
    return { slug };
  });
}
