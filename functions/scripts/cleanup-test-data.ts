// Removes accounts created by automated production checks and everything they own: shops (with
// items, images, jobs, conversations, actions, releases, theme), slug reservations, live pointers,
// usage counters, extraction locks and Storage objects under owners/{uid}/.
//
//   pnpm ops:cleanup-test-data            dry run (lists matches)
//   pnpm ops:cleanup-test-data --apply    delete
//
// Only emails matching TEST_EMAIL are touched. Uses Application Default Credentials against
// GCLOUD_PROJECT (default: shelf2kumo).
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth, type UserRecord } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

export const TEST_EMAIL = /^(s2k-deploy-check|s2k-probe|e2e)-\d+@example\.test$/;

const apply = process.argv.includes('--apply');
const projectId = process.env.GCLOUD_PROJECT ?? 'shelf2kumo';
initializeApp({ credential: applicationDefault(), projectId, storageBucket: `${projectId}.firebasestorage.app` });
const auth = getAuth();
const db = getFirestore();
const bucket = getStorage().bucket();
const verb = apply ? 'DELETE' : 'would delete';

const users: UserRecord[] = [];
let pageToken: string | undefined;
do {
  const page = await auth.listUsers(1000, pageToken);
  users.push(...page.users.filter((user) => TEST_EMAIL.test(user.email ?? '')));
  pageToken = page.pageToken;
} while (pageToken);

for (const user of users) {
  const shops = await db.collection('shops').where('ownerId', '==', user.uid).get();
  console.log(`${verb} user ${user.email} (${user.uid}) with ${shops.size} shop(s)`);
  for (const shop of shops.docs) {
    const slug = String(shop.get('slug'));
    console.log(`  ${verb} shops/${shop.id} (/s/${slug}) and its subcollections`);
    if (!apply) continue;
    for (const path of [`publishedCatalogs/${slug}`, `slugReservations/${slug}`]) {
      const ref = db.doc(path);
      if ((await ref.get()).get('shopId') === shop.id) await ref.delete();
    }
    await db.recursiveDelete(shop.ref);
  }
  const usage = await db.collection('usage').where('ownerId', '==', user.uid).get();
  const [files] = await bucket.getFiles({ prefix: `owners/${user.uid}/` });
  console.log(`  ${verb} ${usage.size} usage doc(s), extraction lock, ${files.length} storage object(s)`);
  if (apply) {
    for (const doc of usage.docs) await doc.ref.delete();
    await db.doc(`extractionLocks/${user.uid}`).delete();
    await bucket.deleteFiles({ prefix: `owners/${user.uid}/`, force: true });
    await auth.deleteUser(user.uid);
  }
}
console.log(`${users.length} test user(s) ${apply ? 'deleted' : 'matched (dry run; add --apply to delete)'} in ${projectId}.`);
