import { z } from 'zod';

/** Application limits for photos (spec §6 Images). Not confirmed AMD limits. */
export const IMAGE_LIMITS = {
  maxUploadBytes: 8 * 1024 * 1024,
  maxPixels: 20_000_000,
  /** Long edge of the browser-side downscale before upload. */
  clientMaxEdge: 2048,
  /** Long edge of the private rendition used for preview, AI input and publishing. */
  renditionMaxEdge: 1600,
  maxImagesPerShop: 200,
} as const;

export const UploadContentType = z.enum(['image/jpeg', 'image/png', 'image/webp']);
export type UploadContentType = z.infer<typeof UploadContentType>;

export const AllocateUploadRequest = z.strictObject({
  contentType: UploadContentType,
  bytes: z.number().int().positive().max(IMAGE_LIMITS.maxUploadBytes),
});
export type AllocateUploadRequest = z.infer<typeof AllocateUploadRequest>;

export interface AllocateUploadResponse {
  imageId: string;
  /** Private Storage path the browser uploads to (owner-only, create-once). */
  uploadPath: string;
}

export type ImageState = 'allocated' | 'processed' | 'rejected';

export type ImageRejectReason = 'missing' | 'too_large' | 'unsupported_format' | 'too_many_pixels' | 'corrupt';

/** Japanese guidance shown when an upload is rejected. */
export const IMAGE_REJECT_MESSAGES: Record<ImageRejectReason, string> = {
  missing: '写真のアップロードが完了していません。もう一度お試しください。',
  too_large: '写真のサイズが大きすぎます（8MB まで）。',
  unsupported_format: 'この形式の画像は使えません。JPEG・PNG・WebP の写真を選んでください。',
  too_many_pixels: '画像の解像度が高すぎます（2,000 万画素まで）。',
  corrupt: '画像を読み込めませんでした。別の写真をお試しください。',
};

export interface ProcessImageResponse {
  imageId: string;
  state: 'processed';
  width: number;
  height: number;
  contentHash: string;
}

/** Client-readable fields of shops/{shopId}/images/{imageId}. */
export interface ImageDoc {
  ownerId: string;
  state: ImageState;
  uploadPath: string;
  renditionPath: string | null;
  width: number | null;
  height: number | null;
  contentHash: string | null;
  rejectReason: ImageRejectReason | null;
}
