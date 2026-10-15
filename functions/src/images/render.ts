import { IMAGE_LIMITS, type ImageRejectReason } from '@shelf2kumo/contracts';
import { createHash } from 'node:crypto';
import sharp, { type Metadata } from 'sharp';

// Decoded images are large; do not keep them in libvips' cache between requests.
sharp.cache(false);

export type RenderResult =
  | { ok: true; rendition: Buffer; width: number; height: number; sourceFormat: string; contentHash: string }
  | { ok: false; reason: ImageRejectReason };

const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp']);

const decodeOptions = { limitInputPixels: IMAGE_LIMITS.maxPixels, failOn: 'warning' as const };

/**
 * Validates actual file content (not the claimed MIME type) and creates the private rendition:
 * EXIF orientation applied, metadata (EXIF/GPS/ICC comments) stripped, transparent areas flattened
 * to white, long edge ≤ renditionMaxEdge, JPEG.
 */
export async function renderImage(input: Buffer): Promise<RenderResult> {
  let metadata: Metadata;
  try {
    metadata = await sharp(input, decodeOptions).metadata();
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (/pixel limit/i.test(message)) return { ok: false, reason: 'too_many_pixels' };
    return { ok: false, reason: /unsupported image format/i.test(message) ? 'unsupported_format' : 'corrupt' };
  }

  if (!metadata.format || !ACCEPTED_FORMATS.has(metadata.format)) return { ok: false, reason: 'unsupported_format' };
  if (!metadata.width || !metadata.height) return { ok: false, reason: 'corrupt' };
  if (metadata.width * metadata.height > IMAGE_LIMITS.maxPixels) return { ok: false, reason: 'too_many_pixels' };

  try {
    const edge = IMAGE_LIMITS.renditionMaxEdge;
    const { data, info } = await sharp(input, decodeOptions)
      .rotate()
      .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    return {
      ok: true,
      rendition: data,
      width: info.width,
      height: info.height,
      sourceFormat: metadata.format,
      contentHash: createHash('sha256').update(data).digest('hex'),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    return { ok: false, reason: /pixel limit/i.test(message) ? 'too_many_pixels' : 'corrupt' };
  }
}
