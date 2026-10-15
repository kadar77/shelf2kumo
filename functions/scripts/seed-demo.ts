// Publishes the labeled DEMO shop (/s/demo) with synthetic product photos (spec §1: seeded examples
// are clearly identified as demo data; demo pages are noindex and excluded from the sitemap).
//
//   pnpm seed:emulator                                   Firestore/Storage emulators (demo-shelf2kumo)
//   GCLOUD_PROJECT=shelf2kumo pnpm seed:demo --confirm    production (Application Default Credentials)
//
// Photos come from evaluation/images/synthetic (run `pnpm eval:images` first); missing photos are
// skipped and the item is shown without a photo.
import { StorefrontSnapshot } from '@shelf2kumo/contracts';
import { demoShopSnapshot } from '@shelf2kumo/contracts/fixtures';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { renderImage } from '../src/images/render.ts';
import { snapshotHash } from '../src/publishing/snapshot.ts';

const projectId = process.env.GCLOUD_PROJECT ?? 'demo-shelf2kumo';
const emulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
if (!emulator && projectId.startsWith('demo-')) throw new Error('Set FIRESTORE_EMULATOR_HOST for the emulator, or GCLOUD_PROJECT for production.');
if (!emulator && !process.argv.includes('--confirm')) throw new Error(`Refusing to write to ${projectId} without --confirm.`);
if (emulator && !projectId.startsWith('demo-')) throw new Error(`Refusing to seed non-demo project ${projectId} in emulator mode.`);

const bucketName = emulator ? `${projectId}.appspot.com` : `${projectId}.firebasestorage.app`;
initializeApp(emulator ? { projectId, storageBucket: bucketName } : { credential: applicationDefault(), projectId, storageBucket: bucketName });
const db = getFirestore();
const bucket = getStorage().bucket();

const PHOTOS: Record<string, string> = {
  demoItem01: 's2-bowl-no-price.jpg',
  demoItem02: 's3-spoon-tax-excluded.jpg',
  demoItem03: 's5-pop-card-linen.jpg',
};

const shopId = 'demoShop';
const media: Record<string, string> = {};
const items = [];
for (const item of demoShopSnapshot.items) {
  const file = PHOTOS[item.id];
  const source = file ? await readFile(fileURLToPath(new URL(`../../evaluation/images/synthetic/${file}`, import.meta.url))).catch(() => null) : null;
  const rendered = source ? await renderImage(source) : null;
  if (rendered?.ok) {
    const path = `demo/renditions/${rendered.contentHash}.jpg`;
    await bucket.file(path).save(rendered.rendition, { contentType: 'image/jpeg', resumable: false, metadata: { cacheControl: 'private, max-age=0' } });
    media[rendered.contentHash] = path;
    items.push({ ...item, image: { contentHash: rendered.contentHash, width: rendered.width, height: rendered.height, alt: `${item.name}（合成画像）` } });
  } else {
    items.push(item);
  }
}

const snapshot = StorefrontSnapshot.parse({ ...demoShopSnapshot, items });
const releaseRef = db.collection(`shops/${shopId}/releases`).doc();
const { shop } = snapshot;
await db.runTransaction(async (tx) => {
  tx.set(db.doc(`shops/${shopId}`), {
    ownerId: 'demo-owner',
    slug: shop.slug,
    slugLocked: true,
    name: shop.name,
    description: shop.description,
    address: shop.address,
    phone: shop.phone,
    hours: shop.hours,
    mapUrl: shop.mapUrl,
    isDemo: true,
    profileRevision: 0,
    contentRevision: 0,
    liveReleaseId: releaseRef.id,
    publishedRevision: 0,
    updatedAt: FieldValue.serverTimestamp(),
  });
  tx.set(db.doc(`slugReservations/${shop.slug}`), { shopId, createdAt: FieldValue.serverTimestamp() });
  tx.create(releaseRef, { ownerId: 'demo-owner', snapshot, media, hash: snapshotHash(snapshot), contentRevision: 0, createdAt: FieldValue.serverTimestamp() });
  tx.set(db.doc(`publishedCatalogs/${shop.slug}`), { shopId, releaseId: releaseRef.id, isDemo: true, publishedAt: FieldValue.serverTimestamp() });
});

console.log(`Published DEMO shop /s/${shop.slug} (release ${releaseRef.id}, ${Object.keys(media).length} synthetic photos) in ${projectId}.`);
