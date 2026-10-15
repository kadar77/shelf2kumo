import { z } from 'zod';
import { DocId } from './common.ts';

/** Daily provider attempts per owner (spec §8), counted in Asia/Tokyo days. */
export const DAILY_EXTRACTION_ATTEMPTS = 20;
/** Maximum provider attempts per job (first try + one retry). */
export const MAX_ATTEMPTS_PER_JOB = 2;
/** Queued or running jobs allowed per owner at once. */
export const MAX_PENDING_JOBS_PER_OWNER = 10;

export const CreateExtractionRequest = z.strictObject({
  imageId: DocId,
  /** Explicit user retry of a finished job: creates a linked job and counts against quota. */
  retryOfJobId: DocId.optional(),
});
export type CreateExtractionRequest = z.infer<typeof CreateExtractionRequest>;

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed';
export type JobOutcome = 'item_created' | 'multiple_products' | 'nothing_found';

export type JobErrorCode = 'quota_exceeded' | 'ai_unavailable' | 'ai_invalid_output' | 'ai_rejected' | 'image_unavailable' | 'lease_expired' | 'catalog_full';

/** Japanese next-step messages for failed extraction jobs. */
export const JOB_ERROR_MESSAGES: Record<JobErrorCode, string> = {
  quota_exceeded: `本日の読み取り回数の上限（${DAILY_EXTRACTION_ATTEMPTS} 回）に達しました。明日もう一度お試しいただくか、手動で商品を追加してください。`,
  ai_unavailable: 'AI サービスに接続できませんでした。時間をおいて再度お試しいただくか、手動で商品を追加してください。',
  ai_invalid_output: '写真から商品情報を読み取れませんでした。もう一度お試しいただくか、手動で商品を追加してください。',
  ai_rejected: 'AI サービスで問題が発生しました。時間をおいて再度お試しいただくか、手動で商品を追加してください。',
  image_unavailable: '写真が見つかりませんでした。もう一度アップロードしてください。',
  lease_expired: '読み取りに時間がかかりすぎたため中断しました。もう一度お試しください。',
  catalog_full: '商品は 1 店舗あたり 50 件までです。不要な商品を削除してから再度お試しください。',
};

export interface CreateExtractionResponse {
  jobId: string;
  state: JobState;
  /** True when an identical request already existed (idempotent replay). */
  duplicate: boolean;
}

/** Client-readable fields of shops/{shopId}/jobs/{jobId}. */
export interface JobDoc {
  ownerId: string;
  imageId: string;
  mode: 'single';
  state: JobState;
  outcome: JobOutcome | null;
  itemId: string | null;
  productCountEstimate: number | null;
  attempt: number;
  retryOf: string | null;
  error: { code: JobErrorCode; message: string; retryable: boolean } | null;
  /** 'fixture' when produced by the emulator-only fixture extractor; never in production. */
  model: string | null;
}
