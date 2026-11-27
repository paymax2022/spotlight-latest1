/**
 * Synthetic images for the blend tests (P2 Task 3).
 *
 * Every geometry a blend assertion expects is *planted* here rather than
 * inferred from a photograph: a fixture whose head box is `[40, 90)` measures a
 * head of exactly 50 rows, so when `measureSubject` disagrees the failure names
 * the algorithm instead of the fixture. Boxes are half-open for that reason.
 *
 * The buffers are built as raw RGBA and encoded by sharp, so no test depends on
 * a fixture file it cannot read and none depends on the encoder's own alpha
 * handling either — `pixelAt` decodes with `.ensureAlpha().raw()` for the same
 * reason spec §2 gives: reading band 3 out of an encoded PNG without `.raw()`
 * hands back compressed bytes that `info.channels` still calls one channel.
 */
import sharp from 'sharp';

export interface Rgba { r: number; g: number; b: number; a: number }
export const CLEAR: Rgba = { r: 0, g: 0, b: 0, a: 0 };

/** Raw RGBA -> PNG, so no test depends on a file it cannot read. */
export async function rgbaPng(width: number, height: number, at: (x: number, y: number) => Rgba): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const { r, g, b, a } = at(x, y);
      const i = (y * width + x) * 4;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = a;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

export const transparentPng = (w: number, h: number) => rgbaPng(w, h, () => CLEAR);
export const flatPng = (w: number, h: number, c: Rgba) => rgbaPng(w, h, () => c);

/** Head + shoulders with exactly known rows, centred horizontally. */
export function figurePng(o: { w?: number; h?: number; headTop?: number; headWidth?: number;
  headHeight?: number; bodyWidth?: number; bodyBottom?: number } = {}) {
  const { w = 200, h = 300, headTop = 40, headWidth = 40, headHeight = 50, bodyWidth = 80, bodyBottom = 260 } = o;
  const cx = Math.round(w / 2);
  return rgbaPng(w, h, (x, y) => {
    if (y >= headTop && y < headTop + headHeight && x >= cx - headWidth / 2 && x < cx + headWidth / 2)
      return { r: 220, g: 180, b: 150, a: 255 };
    if (y >= headTop + headHeight && y < bodyBottom && x >= cx - bodyWidth / 2 && x < cx + bodyWidth / 2)
      return { r: 200, g: 160, b: 130, a: 255 };
    return CLEAR;
  });
}

/** Templates: a solid field, and the same field with the photo window cut out. */
export const opaqueTemplate = (size: number) => flatPng(size, size, { r: 20, g: 40, b: 80, a: 255 });
export const holedTemplate = (size: number, hole: { x: number; y: number; width: number; height: number }) =>
  rgbaPng(size, size, (x, y) => (
    x >= hole.x && x < hole.x + hole.width && y >= hole.y && y < hole.y + hole.height
      ? CLEAR : { r: 20, g: 40, b: 80, a: 255 }
  ));

/** One pixel of a rendered PNG, as [r,g,b] plus its alpha. */
export async function pixelAt(png: Buffer, x: number, y: number): Promise<{ rgb: number[]; a: number }> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return { rgb: [data[i], data[i + 1], data[i + 2]], a: data[i + 3] };
}
export const alphaAt = async (png: Buffer, x: number, y: number) => (await pixelAt(png, x, y)).a;

/** Decoded RGBA, for tests that scan many pixels — `alphaAt` decodes per call. */
export async function rawRgba(png: Buffer) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    data,
    info,
    width: info.width,
    height: info.height,
    alpha: (x: number, y: number) => data[(y * info.width + x) * 4 + 3],
  };
}

export const countAlpha = async (png: Buffer, test: (a: number) => boolean) => {
  const { data } = await rawRgba(png);
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (test(data[i])) n++;
  return n;
};
