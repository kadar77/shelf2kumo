import { StorefrontSnapshot } from '@shelf2kumo/contracts';
import { demoShopSnapshot } from '@shelf2kumo/contracts/fixtures';
import type { Firestore } from 'firebase-admin/firestore';

export interface LiveRelease {
  snapshot: StorefrontSnapshot;
  /** contentHash → private rendition path; never exposed publicly. */
  media: Record<string, string>;
}

/** Loads live release data by slug, or null when the shop is not published. */
export interface SnapshotSource {
  load(slug: string): Promise<StorefrontSnapshot | null>;
  loadRelease(slug: string): Promise<LiveRelease | null>;
  /** Slugs of live, non-demo catalogs (sitemap). */
  listPublished(): Promise<string[]>;
}

/**
 * Production source: publishedCatalogs/{slug} → shops/{shopId}/releases/{releaseId}.
 * Both documents are server-only. The snapshot is revalidated before rendering.
 */
export function firestoreSnapshotSource(db: Firestore): SnapshotSource {
  async function loadRelease(slug: string): Promise<LiveRelease | null> {
    const pointer = await db.doc(`publishedCatalogs/${slug}`).get();
    if (!pointer.exists) return null;
    const { shopId, releaseId } = pointer.data() as { shopId?: unknown; releaseId?: unknown };
    if (typeof shopId !== 'string' || typeof releaseId !== 'string') throw new Error('Invalid live pointer');

    const release = await db.doc(`shops/${shopId}/releases/${releaseId}`).get();
    if (!release.exists) throw new Error('Live pointer references a missing release');
    const media = release.get('media');
    return { snapshot: StorefrontSnapshot.parse(release.get('snapshot')), media: media && typeof media === 'object' ? media : {} };
  }
  return {
    loadRelease,
    async load(slug) {
      return (await loadRelease(slug))?.snapshot ?? null;
    },
    async listPublished() {
      const live = await db.collection('publishedCatalogs').where('isDemo', '==', false).limit(1000).get();
      return live.docs.map((doc) => doc.id).sort();
    },
  };
}

/** FIXTURE source for the emulator without Firestore: serves only the labeled demo shop. */
export const fixtureSnapshotSource: SnapshotSource = {
  async load(slug) {
    return slug === demoShopSnapshot.shop.slug ? demoShopSnapshot : null;
  },
  async loadRelease(slug) {
    return slug === demoShopSnapshot.shop.slug ? { snapshot: demoShopSnapshot, media: {} } : null;
  },
  async listPublished() {
    return [];
  },
};

/**
 * Fixtures are used only in the Functions emulator when no Firestore emulator is running, or when
 * STOREFRONT_FIXTURES=true is set explicitly for local work. Never in deployed functions.
 */
export function shouldUseFixtures(env: NodeJS.ProcessEnv): boolean {
  const inEmulator = env.FUNCTIONS_EMULATOR === 'true';
  return inEmulator && (env.STOREFRONT_FIXTURES === 'true' || !env.FIRESTORE_EMULATOR_HOST);
}
