// Post-deploy check: runs every composite / collection-group query the backend uses against the
// production Firestore with limit(1). The emulator does not enforce indexes, so a missing index only
// shows up here (FAILED_PRECONDITION). Read-only; uses Application Default Credentials.
//
//   pnpm check:queries
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore, type Query } from 'firebase-admin/firestore';

const projectId = process.env.GCLOUD_PROJECT ?? 'shelf2kumo';
initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();
const now = Timestamp.now();
const probeOwner = 'index-probe-owner';

const queries: Array<[string, () => Promise<unknown>]> = [
  ['jobs: pending count per owner (API)', () => db.collectionGroup('jobs').where('ownerId', '==', probeOwner).where('state', 'in', ['queued', 'running']).count().get()],
  ['jobs: oldest queued per owner (kickNext)', () => q(db.collectionGroup('jobs').where('ownerId', '==', probeOwner).where('state', '==', 'queued').orderBy('createdAt'))],
  ['jobs: expired leases (recovery)', () => q(db.collectionGroup('jobs').where('state', '==', 'running').where('leaseExpiresAt', '<', now))],
  ['jobs: stuck queue (recovery)', () => q(db.collectionGroup('jobs').where('state', '==', 'queued').where('createdAt', '<', now))],
  ['images: abandoned uploads (cleanup)', () => q(db.collectionGroup('images').where('state', 'in', ['allocated', 'rejected']).where('createdAt', '<', now))],
  ['chatRequests: stuck requests (recovery)', () => q(db.collectionGroup('chatRequests').where('state', 'in', ['queued', 'running']).where('createdAt', '<', now))],
  ['actions: proposed per request (chat apply)', () => q(db.collection('shops/index-probe/actions').where('requestId', '==', 'probe').where('state', '==', 'proposed'))],
  ['chatRequests: text requests (clear history)', () => q(db.collection('shops/index-probe/chatRequests').where('kind', '==', 'text'))],
  ['shops: count per owner (API)', () => db.collection('shops').where('ownerId', '==', probeOwner).count().get()],
];

function q(query: Query) {
  return query.limit(1).get();
}

let failures = 0;
for (const [label, run] of queries) {
  try {
    await run();
    console.log(`ok    ${label}`);
  } catch (error) {
    failures += 1;
    const message = String((error as Error).message).split('\n')[0]?.slice(0, 140);
    console.log(`FAIL  ${label}: ${message}`);
  }
}
console.log(failures === 0 ? `All ${queries.length} production queries have usable indexes (${projectId}).` : `${failures} query(ies) need an index.`);
process.exitCode = failures === 0 ? 0 : 1;
