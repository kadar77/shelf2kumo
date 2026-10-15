import { createHash } from 'node:crypto';
import sharp, { type Sharp } from 'sharp';
import { describe, expect, it } from 'vitest';
import { renderImage } from '../src/images/render.ts';

const solid = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 60 } } });

describe('renderImage', () => {
  it('downscales to a 1600px JPEG and strips EXIF metadata (including GPS)', async () => {
    const input = await solid(3200, 2400)
      .withExif({
        IFD0: { Copyright: 'secret-owner', ImageDescription: 'private note' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 41/1 0/1', GPSLongitudeRef: 'E', GPSLongitude: '139/1 41/1 0/1' },
      })
      .jpeg()
      .toBuffer();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const result = await renderImage(input);
    if (!result.ok) throw new Error(`unexpected reject: ${result.reason}`);
    const out = await sharp(result.rendition).metadata();
    expect(out.format).toBe('jpeg');
    expect([out.width, out.height]).toEqual([1600, 1200]);
    expect(out.exif).toBeUndefined();
    expect(result.rendition.includes(Buffer.from('secret-owner'))).toBe(false);
    expect(result.contentHash).toBe(createHash('sha256').update(result.rendition).digest('hex'));
  });

  it('applies EXIF orientation before stripping it', async () => {
    const portraitStoredAsLandscape = await solid(400, 200).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const result = await renderImage(portraitStoredAsLandscape);
    if (!result.ok) throw new Error('unexpected reject');
    expect([result.width, result.height]).toEqual([200, 400]);
  });

  it('never enlarges small images and accepts PNG and WebP', async () => {
    for (const encode of [(s: Sharp) => s.png(), (s: Sharp) => s.webp()]) {
      const result = await renderImage(await encode(solid(320, 240)).toBuffer());
      expect(result).toMatchObject({ ok: true, width: 320, height: 240 });
    }
  });

  it('rejects by actual content, not by claimed type', async () => {
    expect(await renderImage(Buffer.from('<html>not an image</html>'))).toEqual({ ok: false, reason: 'unsupported_format' });
    expect(await renderImage(await solid(10, 10).gif().toBuffer())).toEqual({ ok: false, reason: 'unsupported_format' });
  });

  it('rejects images over 20 megapixels', async () => {
    const big = await solid(5000, 4100).png({ compressionLevel: 9 }).toBuffer();
    expect(await renderImage(big)).toEqual({ ok: false, reason: 'too_many_pixels' });
  });

  it('rejects truncated files as corrupt', async () => {
    const jpeg = await solid(800, 600).jpeg().toBuffer();
    const result = await renderImage(jpeg.subarray(0, Math.floor(jpeg.length / 2)));
    expect(result).toMatchObject({ ok: false });
    expect(['corrupt', 'unsupported_format']).toContain((result as { reason: string }).reason);
  });
});
