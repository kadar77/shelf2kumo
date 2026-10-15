import { JOB_ERROR_MESSAGES } from '@shelf2kumo/contracts';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { kickNext } from './worker.ts';

/** A running job is failed once its lease has been expired for this long (spec §8). */
export const LEASE_GRACE_MS = 60_000;
/** Queued jobs older than this are re-kicked in case a wake-up was lost. */
export const STUCK_QUEUE_MS = 2 * 60_000;

/**
 * Fails jobs whose worker vanished (expired lease) with an actionable message, releases their lock,
 * and wakes the next queued job of every affected owner.
 */
export async function recoverExtractionJobs(db: Firestore, now = Date.now()): Promise<{ expired: number; kicked: number }> {
  const owners = new Set<string>();
  let expired = 0;

  const running = await db
    .collectionGroup('jobs')
    .where('state', '==', 'running')
    .where('leaseExpiresAt', '<', Timestamp.fromMillis(now - LEASE_GRACE_MS))
    .limit(100)
    .get();
  for (const doc of running.docs) {
    const failed = await db.runTransaction(async (tx) => {
      const job = await tx.get(doc.ref);
      const lease = job.get('leaseExpiresAt') as Timestamp | null;
      if (job.get('state') !== 'running' || !lease || lease.toMillis() >= now - LEASE_GRACE_MS) return false;
      const ownerId = String(job.get('ownerId'));
      const lock = await tx.get(db.doc(`extractionLocks/${ownerId}`));
      tx.update(doc.ref, {
        state: 'failed',
        leaseToken: null,
        leaseExpiresAt: null,
        error: { code: 'lease_expired', message: JOB_ERROR_MESSAGES.lease_expired, retryable: true },
        finishedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
      if (lock.exists && lock.get('jobId') === doc.id) tx.delete(lock.ref);
      owners.add(ownerId);
      return true;
    });
    if (failed) expired += 1;
  }

  const stuck = await db
    .collectionGroup('jobs')
    .where('state', '==', 'queued')
    .where('createdAt', '<', Timestamp.fromMillis(now - STUCK_QUEUE_MS))
    .limit(100)
    .get();
  for (const doc of stuck.docs) owners.add(String(doc.get('ownerId')));

  for (const ownerId of owners) await kickNext(db, ownerId);
  return { expired, kicked: owners.size };
}
