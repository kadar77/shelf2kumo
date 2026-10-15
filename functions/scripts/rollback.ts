// Operator rollback: moves one shop's live pointer to a previous release (docs/DEPLOYMENT.md).
//
//   pnpm ops:rollback --shop <shopId>                          list releases (read-only)
//   pnpm ops:rollback --shop <shopId> --release <id> --confirm  roll back
//
// Uses Application Default Credentials against GCLOUD_PROJECT (default: shelf2kumo), or the
// Firestore emulator when FIRESTORE_EMULATOR_HOST is set.
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { listReleases, rollbackToRelease } from '../src/publishing/rollback.ts';

const args = process.argv.slice(2);
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const shopId = flag('--shop');
const releaseId = flag('--release');
const projectId = process.env.GCLOUD_PROJECT ?? 'shelf2kumo';

if (!shopId) {
  console.error('Usage: pnpm ops:rollback --shop <shopId> [--release <releaseId> --confirm]');
  process.exit(2);
}

initializeApp(process.env.FIRESTORE_EMULATOR_HOST ? { projectId } : { credential: applicationDefault(), projectId });
const db = getFirestore();

const releases = await listReleases(db, shopId);
console.table(releases);

if (releaseId) {
  if (!args.includes('--confirm')) {
    console.error(`Dry run: add --confirm to make ${releaseId} live for shop ${shopId} in ${projectId}.`);
    process.exit(1);
  }
  const { slug } = await rollbackToRelease(db, shopId, releaseId);
  console.log(`Shop ${shopId} (/s/${slug}) now serves release ${releaseId}. The CDN reflects it within ~60 s.`);
}
