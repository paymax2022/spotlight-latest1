/**
 * Display variants of a finished composite (spec §8: "consistent presentation
 * across surfaces … with variants").
 *
 * One resize, driven by the composite that was just built, not a second render
 * pass. Re-compositing at thumbnail size would put a second copy of the layout
 * rules in this file, and the two would drift — the same reason the compositor
 * owns slot geometry and nothing below it re-derives it.
 *
 * PNG throughout. A JPEG thumbnail would be smaller, but the composite can
 * legitimately have transparent pixels (a template whose background is a cutout
 * shape), and `sharp`'s implicit matte for a flattened alpha channel is a
 * visible colour shift on a contestant's portrait — a byte saving is not worth
 * an unexpected background. Format choice belongs with P2's styling pass, where
 * there is a designed background to flatten onto.
 */
import sharp from 'sharp';

export type VariantName = 'preview' | 'thumbnail';

/** Max widths, not fixed sizes: portrait aspect ratios vary by template, and a
 *  surface that crops to a square crops in CSS where the rule is visible. */
export const VARIANT_MAX_WIDTH: Record<VariantName, number> = {
  preview: 1080,
  thumbnail: 320,
};

export interface VariantImage {
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
}

export async function renderVariant(image: Buffer, name: VariantName): Promise<VariantImage> {
  const maxWidth = VARIANT_MAX_WIDTH[name];
  if (!maxWidth) throw new Error(`Unknown photo variant "${name}"`);

  const resized = await sharp(image)
    .resize({ width: maxWidth, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: resized.data,
    mimeType: 'image/png',
    width: resized.info.width,
    height: resized.info.height,
  };
}
