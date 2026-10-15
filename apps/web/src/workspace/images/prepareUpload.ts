import { IMAGE_LIMITS, type UploadContentType } from '@shelf2kumo/contracts';

export class PrepareUploadError extends Error {}

const ACCEPTED = new Set<string>(['image/jpeg', 'image/png', 'image/webp']);

const isHeic = (file: File) => /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);

/**
 * Downscales a photo in the browser to a JPEG with a long edge of at most 2,048 px (orientation
 * applied, metadata dropped) to cut mobile upload time. Falls back to the original file when the
 * browser cannot decode it but it is an accepted type within limits. The server validates again.
 */
export async function prepareUpload(file: File): Promise<{ blob: Blob; contentType: UploadContentType }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);

  if (bitmap) {
    const scale = Math.min(1, IMAGE_LIMITS.clientMaxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
      if (blob && blob.size <= IMAGE_LIMITS.maxUploadBytes) return { blob, contentType: 'image/jpeg' };
    }
  }

  if (ACCEPTED.has(file.type) && file.size <= IMAGE_LIMITS.maxUploadBytes) {
    return { blob: file, contentType: file.type as UploadContentType };
  }
  if (isHeic(file)) {
    throw new PrepareUploadError(
      'HEIC 形式の写真を読み込めませんでした。iPhone の「設定 > カメラ > フォーマット」で「互換性優先」を選ぶか、JPEG の写真を選んでください。',
    );
  }
  if (file.size > IMAGE_LIMITS.maxUploadBytes) throw new PrepareUploadError('写真のサイズが大きすぎます（8MB まで）。');
  throw new PrepareUploadError('この形式の画像は使えません。JPEG・PNG・WebP の写真を選んでください。');
}
