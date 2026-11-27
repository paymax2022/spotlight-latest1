/**
 * Task 6 — the variant resize, tested against real pixels.
 *
 * The runner suite stubs this module because its compositor stub hands back
 * `Buffer.from('final')`, which sharp cannot decode; that stub is why the resize
 * itself has to have its own test with a genuine PNG. Everything asserted here
 * is measured by re-opening the output with sharp, so a function that returned
 * the input buffer untouched, or a buffer that is not an image, could not pass.
 */
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { renderVariant, VARIANT_MAX_WIDTH } from '@/src/server/photo-jobs/variants';

/** 1080x1350 with a hard-edged shape, so a silent crop or a flatten onto a
 *  matte shows up in the measured size or the channel count. */
async function sampleFinal(width = 1080, height = 1350): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 4, background: { r: 210, g: 32, b: 96, alpha: 1 } },
  })
    .composite([
      { input: Buffer.from(`<svg width="${width}" height="${height}"><rect x="${width / 4}" y="${height / 4}" width="${width / 2}" height="${height / 2}" fill="white"/></svg>`), top: 0, left: 0 },
    ])
    .png()
    .toBuffer();
}

describe('renderVariant', () => {
  it('scales a portrait composite down to the thumbnail width and keeps the aspect ratio', async () => {
    const out = await renderVariant(await sampleFinal(), 'thumbnail');
    const meta = await sharp(out.buffer).metadata();

    expect(out.width).toBe(320);
    expect(meta.width).toBe(VARIANT_MAX_WIDTH.thumbnail);
    expect(meta.height).toBe(400);
    expect(out.mimeType).toBe('image/png');
  });

  it('leaves an already-small composite alone instead of upscaling it', async () => {
    const out = await renderVariant(await sampleFinal(400, 500), 'preview');
    expect(out.width).toBe(400);
    expect(out.height).toBe(500);
  });

  it('keeps the alpha channel, so nothing is flattened onto an unexpected matte', async () => {
    const transparent = await sharp({
      create: { width: 640, height: 800, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).png().toBuffer();

    const out = await renderVariant(transparent, 'preview');
    const meta = await sharp(out.buffer).metadata();

    expect(meta.hasAlpha).toBe(true);
    expect(meta.channels).toBe(4);
  });

  it('produces a preview that is the same shape as the composite, not a square crop', async () => {
    const out = await renderVariant(await sampleFinal(1080, 1350), 'preview');
    expect(out.width).toBe(1080);
    expect(out.height).toBe(1350);
    expect(await sharp(out.buffer).metadata()).toMatchObject({ width: 1080, height: 1350 });
  });

  it('refuses an unknown variant name rather than guessing a width', async () => {
    await expect(renderVariant(await sampleFinal(), 'banner' as never)).rejects.toThrow(/Unknown photo variant/);
  });
});
