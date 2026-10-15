import { EXTRACTION_PROMPT_VERSION } from '@shelf2kumo/ai';
import {
  DAILY_EXTRACTION_ATTEMPTS,
  MAX_PENDING_JOBS_PER_OWNER,
  type CreateExtractionRequest,
  type CreateExtractionResponse,
  type JobDoc,
  type JobState,
} from '@shelf2kumo/contracts';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { HttpError, notFound } from '../api/http.ts';
import { attemptsToday } from './usage.ts';

export interface ExtractionJobService {
  create(ownerId: string, shopId: string, request: CreateExtractionRequest): Promise<CreateExtractionResponse>;
}

/**
 * Idempotency key (spec §8): owner + shop + image content + prompt version + intent. A user retry
 * adds the original job ID, so it creates a new linked job instead of replaying the old one.
 */
export function extractionJobId(parts: { ownerId: string; shopId: string; contentHash: string; retryOf?: string }): string {
  const key = [parts.ownerId, parts.shopId, parts.contentHash, EXTRACTION_PROMPT_VERSION, 'create_item', parts.retryOf ?? ''].join('|');
  return `x${createHash('sha256').update(key).digest('hex').slice(0, 27)}`;
}

const quotaExceeded = () =>
  new HttpError(429, 'quota_exceeded', `本日の読み取り回数の上限（${DAILY_EXTRACTION_ATTEMPTS} 回）に達しました。手動で商品を追加できます。`);

export function firestoreExtractionJobService(db: Firestore, now: () => number = Date.now): ExtractionJobService {
  return {
    async create(ownerId, shopId, request) {
      const image = await db.doc(`shops/${shopId}/images/${request.imageId}`).get();
      if (!image.exists || image.get('ownerId') !== ownerId) throw notFound();
      const contentHash = image.get('contentHash');
      if (image.get('state') !== 'processed' || typeof contentHash !== 'string') {
        throw new HttpError(400, 'image_rejected', '写真の準備ができていません。もう一度アップロードしてください。');
      }

      if (request.retryOfJobId) {
        const original = await db.doc(`shops/${shopId}/jobs/${request.retryOfJobId}`).get();
        if (!original.exists || original.get('ownerId') !== ownerId) throw notFound();
        if (!['succeeded', 'failed'].includes(original.get('state'))) {
          throw new HttpError(409, 'conflict', 'この写真はまだ読み取り中です。完了までお待ちください。');
        }
      }

      const jobId = extractionJobId({ ownerId, shopId, contentHash, retryOf: request.retryOfJobId });
      const jobRef = db.doc(`shops/${shopId}/jobs/${jobId}`);
      const existing = await jobRef.get();
      if (existing.exists) return { jobId, state: existing.get('state') as JobState, duplicate: true };

      if ((await attemptsToday(db, ownerId, now())) >= DAILY_EXTRACTION_ATTEMPTS) throw quotaExceeded();
      const pending = await db
        .collectionGroup('jobs')
        .where('ownerId', '==', ownerId)
        .where('state', 'in', ['queued', 'running'])
        .count()
        .get();
      if (pending.data().count >= MAX_PENDING_JOBS_PER_OWNER) {
        throw new HttpError(429, 'quota_exceeded', '読み取り待ちの写真が多すぎます。完了してから追加してください。');
      }

      const job: JobDoc = {
        ownerId,
        imageId: request.imageId,
        mode: 'single',
        state: 'queued',
        outcome: null,
        itemId: null,
        productCountEstimate: null,
        attempt: 0,
        retryOf: request.retryOfJobId ?? null,
        error: null,
        model: null,
      };
      try {
        // create() fails if a concurrent duplicate won the race; both callers get the same job.
        await jobRef.create({ ...job, contentHash, kick: 0, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() });
        return { jobId, state: 'queued', duplicate: false };
      } catch (error) {
        if ((error as { code?: number }).code === 6) {
          const raced = await jobRef.get();
          return { jobId, state: raced.get('state') as JobState, duplicate: true };
        }
        throw error;
      }
    },
  };
}
