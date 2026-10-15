import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { message, messagesCol } from './service.ts';

/** Chat requests still queued or running after this long are failed with a visible reply. */
export const CHAT_STUCK_MS = 4 * 60_000;

export async function recoverChatRequests(db: Firestore, now = Date.now()): Promise<number> {
  const stuck = await db
    .collectionGroup('chatRequests')
    .where('state', 'in', ['queued', 'running'])
    .where('createdAt', '<', Timestamp.fromMillis(now - CHAT_STUCK_MS))
    .limit(100)
    .get();
  let failed = 0;
  for (const doc of stuck.docs) {
    const shopId = doc.ref.parent.parent?.id;
    if (!shopId) continue;
    const done = await db.runTransaction(async (tx) => {
      const request = await tx.get(doc.ref);
      if (!['queued', 'running'].includes(request.get('state'))) return false;
      tx.update(doc.ref, { state: 'failed', outcome: 'timed_out' });
      tx.create(
        messagesCol(db, shopId).doc(),
        message('assistant', '応答に時間がかかりすぎたため中断しました。もう一度お試しください。', doc.id),
      );
      return true;
    });
    if (done) failed += 1;
  }
  return failed;
}
