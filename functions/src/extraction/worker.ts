import { AmdError, ExtractionOutputError, type ExtractRequest, type ExtractResult } from '@shelf2kumo/ai';
import {
  JOB_ERROR_MESSAGES,
  LIMITS,
  MAX_ATTEMPTS_PER_JOB,
  type ItemDoc,
  type JobErrorCode,
  type JobOutcome,
} from '@shelf2kumo/contracts';
import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { createHash, randomUUID } from 'node:crypto';
import type { ObjectStore } from '../images/store.ts';
import { QuotaExceeded, reserveAttempt } from './usage.ts';

export type Extractor = (request: ExtractRequest) => Promise<ExtractResult>;

export interface WorkerDeps {
  db: Firestore;
  store: ObjectStore;
  extractor: Extractor;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  log?: (message: string, data: Record<string, unknown>) => void;
}

/** Lease covers two provider attempts (≤ 60 s each) plus backoff; the worker timeout is 300 s. */
export const LEASE_MS = 240_000;

export type RunResult = 'not_queued' | 'busy' | 'stale' | 'succeeded' | 'failed';

interface Claim {
  ownerId: string;
  imageId: string;
  leaseToken: string;
}

type Completion =
  | { kind: 'success'; extraction: ExtractResult }
  | { kind: 'failure'; code: JobErrorCode; retryable: boolean };

const lockRef = (db: Firestore, ownerId: string) => db.doc(`extractionLocks/${ownerId}`);

/** Claims a queued job if the owner has no other active extraction (one per owner, spec §8). */
async function claim(deps: Required<Pick<WorkerDeps, 'db' | 'now'>>, shopId: string, jobId: string): Promise<Claim | 'not_queued' | 'busy'> {
  const { db, now } = deps;
  const jobRef = db.doc(`shops/${shopId}/jobs/${jobId}`);
  return db.runTransaction(async (tx) => {
    const job = await tx.get(jobRef);
    if (!job.exists || job.get('state') !== 'queued') return 'not_queued' as const;
    const ownerId = String(job.get('ownerId'));
    const lock = await tx.get(lockRef(db, ownerId));
    const lockExpires = (lock.get('leaseExpiresAt') as Timestamp | undefined)?.toMillis() ?? 0;
    if (lock.exists && lock.get('jobId') !== jobId && lockExpires > now()) return 'busy' as const;

    const leaseToken = randomUUID();
    const leaseExpiresAt = Timestamp.fromMillis(now() + LEASE_MS);
    tx.set(lockRef(db, ownerId), { jobId, shopId, leaseExpiresAt });
    tx.update(jobRef, {
      state: 'running',
      leaseToken,
      leaseExpiresAt,
      startedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { ownerId, imageId: String(job.get('imageId')), leaseToken };
  });
}

/** Counts one provider attempt against the job and the owner's daily allowance, under the lease. */
async function reserve(db: Firestore, now: number, shopId: string, jobId: string, held: Claim): Promise<'ok' | 'lost' | 'quota'> {
  const jobRef = db.doc(`shops/${shopId}/jobs/${jobId}`);
  try {
    return await db.runTransaction(async (tx) => {
      const job = await tx.get(jobRef);
      if (job.get('state') !== 'running' || job.get('leaseToken') !== held.leaseToken) return 'lost' as const;
      const commit = await reserveAttempt(tx, db, held.ownerId, now);
      commit();
      tx.update(jobRef, { attempt: Number(job.get('attempt') ?? 0) + 1, updatedAt: FieldValue.serverTimestamp() });
      return 'ok' as const;
    });
  } catch (error) {
    if (error instanceof QuotaExceeded) return 'quota';
    throw error;
  }
}

function outcomeOf(extraction: ExtractResult): JobOutcome {
  const { output } = extraction;
  if (output.productCountEstimate > 1 || output.items.length > 1) return 'multiple_products';
  return output.items.length === 0 ? 'nothing_found' : 'item_created';
}

/**
 * Finishes the job in one transaction: item (ID = job ID), provenance, contentRevision, job state and
 * lock release. Only the current lease holder can finalize, so a stale or redelivered worker can
 * neither duplicate an item nor recreate one the owner has since edited or removed.
 */
async function finalize(deps: Required<Pick<WorkerDeps, 'db' | 'now'>>, shopId: string, jobId: string, held: Claim, completion: Completion): Promise<boolean> {
  const { db, now } = deps;
  const jobRef = db.doc(`shops/${shopId}/jobs/${jobId}`);
  const shopRef = db.doc(`shops/${shopId}`);
  const itemRef = db.doc(`shops/${shopId}/items/${jobId}`);

  return db.runTransaction(async (tx) => {
    const job = await tx.get(jobRef);
    if (job.get('state') !== 'running' || job.get('leaseToken') !== held.leaseToken) return false;
    const shop = await tx.get(shopRef);
    const lock = await tx.get(lockRef(db, held.ownerId));
    const itemCount = completion.kind === 'success' ? (await tx.get(db.collection(`shops/${shopId}/items`).count())).data().count : 0;

    let result: Completion = completion;
    let outcome: JobOutcome | null = null;
    if (completion.kind === 'success') {
      outcome = outcomeOf(completion.extraction);
      if (outcome === 'item_created' && (!shop.exists || itemCount >= LIMITS.itemsPerShop)) {
        result = { kind: 'failure', code: 'catalog_full', retryable: false };
        outcome = null;
      }
    }

    const finished = { leaseToken: null, leaseExpiresAt: null, finishedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
    if (result.kind === 'success') {
      const { output, completion: meta, promptVersion } = result.extraction;
      const first = output.items[0];
      if (outcome === 'item_created' && first) {
        const item: ItemDoc = {
          name: first.name,
          description: first.description,
          category: first.category,
          priceJpy: first.priceJpy,
          currency: 'JPY',
          taxTreatment: first.taxTreatment,
          imageId: held.imageId,
          order: now(),
          revision: 0,
          sourceJobId: jobId,
          uncertainFields: [...new Set(first.uncertainFields)],
        };
        tx.create(itemRef, { ...item, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        tx.update(shopRef, { contentRevision: Number(shop.get('contentRevision') ?? 0) + 1, updatedAt: FieldValue.serverTimestamp() });
      }
      // Private provenance; internal audit data, never a review queue.
      tx.set(jobRef.collection('results').doc(jobId), {
        evidenceText: first?.evidenceText ?? null,
        uncertainFields: first?.uncertainFields ?? [],
        warnings: output.warnings,
        productCountEstimate: output.productCountEstimate,
        outputHash: createHash('sha256').update(JSON.stringify(output)).digest('hex'),
        promptVersion,
        requestedModel: meta.requestedModel,
        returnedModel: meta.returnedModel,
        finishReason: meta.finishReason,
        latencyMs: meta.latencyMs,
        usage: meta.usage,
        createdAt: FieldValue.serverTimestamp(),
      });
      tx.update(jobRef, {
        ...finished,
        state: 'succeeded',
        outcome,
        itemId: outcome === 'item_created' ? jobId : null,
        productCountEstimate: output.productCountEstimate,
        model: meta.requestedModel,
        returnedModel: meta.returnedModel,
        promptVersion,
        error: null,
      });
    } else {
      tx.update(jobRef, {
        ...finished,
        state: 'failed',
        outcome: null,
        error: { code: result.code, message: JOB_ERROR_MESSAGES[result.code], retryable: result.retryable },
      });
    }
    if (lock.exists && lock.get('jobId') === jobId) tx.delete(lock.ref);
    return true;
  });
}

/** Wakes the owner's oldest queued job (its trigger re-fires on the `kick` change). */
export async function kickNext(db: Firestore, ownerId: string): Promise<void> {
  const next = await db
    .collectionGroup('jobs')
    .where('ownerId', '==', ownerId)
    .where('state', '==', 'queued')
    .orderBy('createdAt')
    .limit(1)
    .get();
  const doc = next.docs[0];
  if (doc) await doc.ref.update({ kick: FieldValue.increment(1) });
}

function backoffMs(attempt: number, error: unknown, random: () => number): number {
  if (error instanceof AmdError && error.retryAfterMs !== undefined) return Math.min(error.retryAfterMs, 15_000);
  return 2_000 * 2 ** (attempt - 1) + Math.floor(random() * 1_000);
}

function failureCode(error: unknown): { code: JobErrorCode; retryable: boolean } {
  if (error instanceof ExtractionOutputError) return { code: 'ai_invalid_output', retryable: true };
  if (error instanceof AmdError && !error.retryable) return { code: 'ai_rejected', retryable: true };
  return { code: 'ai_unavailable', retryable: true };
}

/** Processes one job end to end. Safe to call repeatedly or concurrently for the same job. */
export async function runExtractionJob(input: WorkerDeps, shopId: string, jobId: string): Promise<RunResult> {
  const deps = {
    now: Date.now,
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    random: Math.random,
    log: () => undefined,
    ...input,
  };
  const claimed = await claim(deps, shopId, jobId);
  if (claimed === 'not_queued' || claimed === 'busy') return claimed;

  const finish = async (completion: Completion): Promise<RunResult> => {
    const done = await finalize(deps, shopId, jobId, claimed, completion);
    return done ? (completion.kind === 'success' ? 'succeeded' : 'failed') : 'stale';
  };

  try {
    const image = await deps.db.doc(`shops/${shopId}/images/${claimed.imageId}`).get();
    const renditionPath = image.get('renditionPath');
    if (image.get('state') !== 'processed' || typeof renditionPath !== 'string') {
      return await finish({ kind: 'failure', code: 'image_unavailable', retryable: false });
    }
    const imageBytes = await deps.store.read(renditionPath).catch(() => null);
    if (!imageBytes) return await finish({ kind: 'failure', code: 'image_unavailable', retryable: false });

    let lastError: unknown;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS_PER_JOB; attempt += 1) {
      const reservation = await reserve(deps.db, deps.now(), shopId, jobId, claimed);
      if (reservation === 'lost') return 'stale';
      if (reservation === 'quota') return await finish({ kind: 'failure', code: 'quota_exceeded', retryable: false });

      try {
        const extraction = await deps.extractor({ imageBytes, mimeType: 'image/jpeg', mode: 'single' });
        deps.log('extraction attempt succeeded', {
          jobId,
          attempt,
          requestedModel: extraction.completion.requestedModel,
          returnedModel: extraction.completion.returnedModel,
          promptVersion: extraction.promptVersion,
          latencyMs: extraction.completion.latencyMs,
          totalTokens: extraction.completion.usage.totalTokens ?? null,
          providerRequestId: extraction.completion.providerRequestId,
        });
        return await finish({ kind: 'success', extraction });
      } catch (error) {
        lastError = error;
        const retryable = error instanceof ExtractionOutputError || (error instanceof AmdError && error.retryable);
        deps.log('extraction attempt failed', {
          jobId,
          attempt,
          errorClass: error instanceof Error ? error.name : 'unknown',
          kind: (error as { kind?: string }).kind ?? null,
          status: (error as { status?: number }).status ?? null,
          retryable,
        });
        if (!retryable || attempt === MAX_ATTEMPTS_PER_JOB) break;
        await deps.sleep(backoffMs(attempt, error, deps.random));
      }
    }
    return await finish({ kind: 'failure', ...failureCode(lastError) });
  } catch (error) {
    deps.log('extraction job crashed', { jobId, errorClass: error instanceof Error ? error.name : 'unknown' });
    return finish({ kind: 'failure', code: 'ai_unavailable', retryable: true }).catch(() => 'stale' as const);
  } finally {
    await kickNext(deps.db, claimed.ownerId).catch(() => undefined);
  }
}
