/**
 * Grounding shadows (spec §7).
 *
 * Two underlays, both cut from the subject's own matte and both black:
 *
 * - **Drop** — the silhouette grown by 1.02 about its centre, blurred to the
 *   preset's blur size, and pushed down by `shadowOffsetPx`. Growing it slightly
 *   keeps the shadow's shoulder outside the figure even where the offset is
 *   small, which is what stops the two edges from beating against each other.
 * - **Contact** — the same silhouette flattened into a short band at the
 *   figure's lowest row: `max(4, 4 % of the target height)` tall, from
 *   `bboxBottom − contactHeight` to `bboxBottom + 2`, with one column's value
 *   taken as the widest run the feet reach in that column. It carries the
 *   weight the drop shadow cannot: a cast shadow says "there is a ground",
 *   a contact shadow says "the figure is touching it".
 *
 * Both are multiplied by `1 − alphaSubject` *after* the blur. That order is the
 * whole reason the two prohibitions in §7 hold by construction: nothing can be
 * drawn where the figure is opaque, so a shadow can neither ring the subject
 * like an outline nor glow out of it, and blurring first means the mask, which
 * is sampled from the un-grown matte at the subject's real position, gets the
 * last word.
 *
 * The `auto` mode turns the pass off whenever the render clips — either because
 * the placement carries a photo-area window, or because the slot has a border
 * radius (§7 names that one) — since a shadow would then fall on the window's
 * own art rather than on a ground, which reads as a smudge; `on` overrides that,
 * `off` never runs.
 *
 * Coordinates: every layer is addressed in canvas pixels, and its buffer is a
 * padded canvas — `pad = ceil(2 × shadowBlurPx)` on each side so the blur has
 * room to fade instead of being cut by the placement box. The subject grid is
 * resampled to the target rectangle first, so the mask lines up with the bytes
 * the compositor is about to draw rather than with the source image.
 */
import sharp from 'sharp';
import type { BlendParams } from './params';
import type { Placement } from './placement';
import type { SubjectMetrics } from './subject-metrics';
import { boxBlurBand, boxBlurBandTwice, radiusForSigma } from './box-blur';

export interface Underlay {
  /** PNG of a black layer whose only varying channel is alpha */
  buffer: Buffer;
  /** absolute canvas position of the buffer's top-left corner */
  left: number;
  top: number;
}

/** §12's blur numbers are the shadow's σ budget; twice that in pad is ample room. */
const PAD_SHARE_OF_BLUR = 2;
/** §7: the drop silhouette is grown a little so its edge is never the subject's edge. */
const DROP_GROW = 1.02;
/** §7: the contact band is 4 % of the target height, and never shorter than 4 rows. */
const CONTACT_HEIGHT_SHARE = 0.04;
const CONTACT_HEIGHT_MIN_PX = 4;
/** §7: the band reaches two rows past the figure's lowest row. */
const CONTACT_ROWS_BELOW_FEET = 2;

export async function buildShadowLayers(
  subject: Buffer,
  placement: Placement,
  metrics: SubjectMetrics,
  params: BlendParams,
  /** §7's other `auto` trigger: the slot rounds its subject off (`border_radius > 0`). */
  slotClips = false,
): Promise<Underlay[]> {
  if (params.shadow === 'off') return [];
  if (params.shadow === 'auto' && (placement.clip !== undefined || slotClips)) return [];

  const wantDrop = params.dropOpacity > 0;
  const wantContact = params.contactOpacity > 0;
  if (!wantDrop && !wantContact) return [];

  const target = { ...placement.target };
  const offset = Math.max(0, Math.round(params.shadowOffsetPx));
  const pad = Math.max(0, Math.ceil(PAD_SHARE_OF_BLUR * params.shadowBlurPx));
  const width = Math.max(1, target.width + 2 * pad);
  const height = Math.max(1, target.height + 2 * pad + offset);

  // The matte in the grid the subject will actually be drawn in. Un-grown and
  // un-offset: it is the mask, so it has to be the figure as rendered.
  const silhouette = await alphaBand(subject, target.width, target.height);
  const layers: Underlay[] = [];

  if (wantDrop) {
    const grown = await growAboutCentre(silhouette, target.width, target.height, DROP_GROW);
    const band = new Uint8Array(width * height);
    paste(band, width, grown, target.width, target.height, pad, pad + offset);
    const blurred = boxBlurBandTwice(band, width, height, radiusForSigma(params.shadowBlurPx / 2));
    // The matte's origin inside this padded band, given the band starts `pad`
    // left of and `offset` above the subject's own top-left.
    layers.push({
      buffer: await shade(blurred, width, height, silhouette, target, pad, pad - offset, params.dropOpacity),
      left: target.left - pad,
      top: target.top - pad + offset,
    });
  }

  if (wantContact) {
    const contactHeight = Math.max(CONTACT_HEIGHT_MIN_PX, Math.round(target.height * CONTACT_HEIGHT_SHARE));
    const pxPerSubjectRow = target.height / Math.max(1, placement.source.height);
    const feetY = Math.round((metrics.bottomY - placement.source.y) * pxPerSubjectRow);   // target-local
    const footprint = footprintColumns(silhouette, target.width, target.height, feetY, contactHeight);

    const band = new Uint8Array(width * height);
    const topRow = feetY - contactHeight;
    for (let row = topRow; row <= feetY + CONTACT_ROWS_BELOW_FEET; row++) {
      if (row < 0 || row >= target.height) continue;
      paste(band, width, footprint, footprint.length, 1, pad, pad + row);
    }
    // A flattening blur, not a cast one: the window is the band's own height.
    const blurred = boxBlurBand(band, width, height, Math.max(1, Math.round(contactHeight / 2)));
    layers.push({
      buffer: await shade(blurred, width, height, silhouette, target, pad, pad, params.contactOpacity),
      left: target.left - pad,
      // No offset: the contact shadow belongs at the feet, not below them.
      top: target.top - pad,
    });
  }

  return layers;
}

/**
 * The black layer, alpha-masked against the subject: `blurred × (1 − a) ×
 * opacity`, which is §7's "multiplied by 1 − alphaSubject" and caps the result
 * at the preset's opacity because `blurred ≤ 255` and `1 − a ≤ 1`.
 */
function shade(
  blurred: Uint8Array,
  width: number,
  height: number,
  silhouette: Uint8Array,
  target: { left: number; top: number; width: number; height: number },
  originX: number,
  originY: number,
  opacity: number,
): Promise<Buffer> {
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const sx = x - originX;
      const sy = y - originY;
      const subject = sx >= 0 && sx < target.width && sy >= 0 && sy < target.height
        ? silhouette[sy * target.width + sx]
        : 0;
      out[i * 4 + 3] = Math.min(255, Math.round(blurred[i] * (1 - subject / 255) * opacity));
      // RGB stays 0. A shadow is #000; anything else would be a colour the
      // light-match pass has no way to justify.
    }
  }
  return sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

/**
 * §7's "the widest run the feet reach in that column": per column, the maximum
 * matte value over the `contactHeight` rows ending at the figure's lowest row.
 */
function footprintColumns(
  silhouette: Uint8Array,
  width: number,
  height: number,
  feetY: number,
  contactHeight: number,
): Uint8Array {
  const out = new Uint8Array(width);
  const first = Math.max(0, feetY - contactHeight + 1);
  const last = Math.min(height - 1, feetY);
  for (let x = 0; x < width; x++) {
    let max = 0;
    for (let y = first; y <= last; y++) {
      const v = silhouette[y * width + x];
      if (v > max) max = v;
    }
    out[x] = max;
  }
  return out;
}

/** Copy `src` into `dst` at a pixel offset, clipping to `dst`'s bounds. */
function paste(
  dst: Uint8Array,
  dstWidth: number,
  src: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  dx: number,
  dy: number,
): void {
  const dstHeight = Math.floor(dst.length / dstWidth);
  for (let y = 0; y < srcHeight; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dstHeight) continue;
    for (let x = 0; x < srcWidth; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dstWidth) continue;
      dst[ty * dstWidth + tx] = src[y * srcWidth + x];
    }
  }
}

/** The subject's alpha as a one-band grid resampled to the target rectangle. */
async function alphaBand(png: Buffer, width: number, height: number): Promise<Uint8Array> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const band = new Uint8Array(info.width * info.height);
  for (let i = 0; i < band.length; i++) band[i] = data[i * info.channels + 3];
  return resampleBand(band, info.width, info.height, width, height);
}

/**
 * `fit: 'fill'` because the target rectangle *is* the size, and `linear` rather
 * than the default lanczos because this band is a matte: lanczos rings past
 * both ends of a 0/255 step, and a shadow mask with negative lobes is a shadow
 * that eats into the figure it is supposed to sit behind.
 */
async function resampleBand(
  band: Uint8Array,
  fromWidth: number,
  fromHeight: number,
  toWidth: number,
  toHeight: number,
): Promise<Uint8Array> {
  if (fromWidth === toWidth && fromHeight === toHeight) return band;
  const { data, info } = await sharp(Buffer.from(band), { raw: { width: fromWidth, height: fromHeight, channels: 1 } })
    .resize(toWidth, toHeight, { fit: 'fill', kernel: 'linear' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = new Uint8Array(toWidth * toHeight);
  const channels = info.channels;
  for (let i = 0; i < out.length; i++) out[i] = data[i * channels];
  return out;
}

/** Scale a band by `factor` about its centre, keeping its dimensions. */
async function growAboutCentre(
  band: Uint8Array,
  width: number,
  height: number,
  factor: number,
): Promise<Uint8Array> {
  const grownWidth = Math.max(width, Math.round(width * factor));
  const grownHeight = Math.max(height, Math.round(height * factor));
  if (grownWidth === width && grownHeight === height) return band;
  const grown = await resampleBand(band, width, height, grownWidth, grownHeight);
  const left = Math.floor((grownWidth - width) / 2);
  const top = Math.floor((grownHeight - height) / 2);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) out[y * width + x] = grown[(y + top) * grownWidth + x + left];
  }
  return out;
}
