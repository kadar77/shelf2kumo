import { DAILY_EXTRACTION_ATTEMPTS } from '@shelf2kumo/contracts';
import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';

const tokyoDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' });

/** usage/{ownerId}_{yyyymmdd} in Asia/Tokyo days (spec §6). Server-only document. */
export function usageRef(db: Firestore, ownerId: string, now: number): DocumentReference {
  return db.doc(`usage/${ownerId}_${tokyoDay.format(new Date(now)).replaceAll('-', '')}`);
}

export async function attemptsToday(db: Firestore, ownerId: string, now: number): Promise<number> {
  return Number((await usageRef(db, ownerId, now).get()).get('extractionAttempts') ?? 0);
}

/**
 * Reserves one provider attempt inside the caller's transaction. Returns false when today's allowance
 * is used up. Must run before any write in the transaction (it reads).
 */
export async function reserveAttempt(tx: Transaction, db: Firestore, ownerId: string, now: number): Promise<() => void> {
  const ref = usageRef(db, ownerId, now);
  const used = Number((await tx.get(ref)).get('extractionAttempts') ?? 0);
  if (used >= DAILY_EXTRACTION_ATTEMPTS) throw new QuotaExceeded();
  return () => tx.set(ref, { ownerId, extractionAttempts: used + 1 }, { merge: true });
}

export class QuotaExceeded extends Error {
  constructor() {
    super('Daily extraction allowance exhausted');
    this.name = 'QuotaExceeded';
  }
}
