// Seeds the Firestore EMULATOR with the labeled demo shop as a published release, exercising the
// production storefront path (publishedCatalogs/{slug} → shops/{shopId}/releases/{releaseId}).
// Refuses to run against anything but an emulator and a demo-* project.
//
//   pnpm seed:emulator   (with `pnpm emulators:all` running)
import { demoShopSnapshot } from '@shelf2kumo/contracts/fixtures';
import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const projectId = process.env.GCLOUD_PROJECT ?? 'demo-shelf2kumo';
if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('FIRESTORE_EMULATOR_HOST is not set; refusing to seed.');
if (!projectId.startsWith('demo-')) throw new Error(`Refusing to seed non-demo project ${projectId}.`);

initializeApp({ projectId });
const db = getFirestore();

const shopId = 'demoShop';
const releaseId = 'demoRelease1';
const { shop } = demoShopSnapshot;

await db.doc(`shops/${shopId}`).set({
  ownerId: 'demo-owner',
  slug: shop.slug,
  slugLocked: true,
  name: shop.name,
  description: shop.description,
  isDemo: true,
  liveReleaseId: releaseId,
  updatedAt: FieldValue.serverTimestamp(),
});
await db.doc(`shops/${shopId}/releases/${releaseId}`).set({
  snapshot: demoShopSnapshot,
  createdAt: FieldValue.serverTimestamp(),
});
await db.doc(`publishedCatalogs/${shop.slug}`).set({
  shopId,
  releaseId,
  isDemo: true,
  publishedAt: FieldValue.serverTimestamp(),
});

console.log(`Seeded demo shop "${shop.slug}" (FIXTURE) into ${process.env.FIRESTORE_EMULATOR_HOST} for ${projectId}.`);
