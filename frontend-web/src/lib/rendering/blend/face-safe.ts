/**
 * Face-safe layering (spec §8.2).
 *
 * A foreground overlay — laurel, ribbon, badge — has to pass *behind* the face
 * while staying exactly as bright everywhere else. The cut is made in the
 * overlay's alpha over an ellipse fitted to the derived face box:
 *
 * ```
 * ρ = √((dx / (faceW/2))² + (dy / (faceH/2))²)        // 1.0 at the box edge
 * w = max(0, 1 − ρ / (1 + FEATHER))                   // 1 at the centre, 0 at 1.2
 * a' = round(a · (1 − strength · w))
 * ```
 *
 * Three things follow from writing it that way. The falloff is monotone away
 * from the centre, so §8.2's "strongest at the centre of the face box" is a
 * property of the formula rather than a check. The feather lives outside the
 * box — the reduction is still 17 % at ρ = 1 and reaches zero at ρ = 1.2 — which
 * is what makes the boundary invisible without a second blur pass. And because
 * only alpha is written, the overlay's own colour is byte-identical under the
 * cut: a face-safe laurel is a laurel with a hole in it, not a laurel with a
 * grey smudge on it.
 *
 * `strength` is the preset's, not a guess made here, and an overlay whose face
 * box misses the placement rectangle comes back as the same buffer it went in:
 * a Mode B window whose subject is out of frame, or a `face_protect` slot whose
 * matte produced no face, must not pay for a pass that can do nothing.
 */
import sharp from 'sharp';
import type { Rect } from './subject-metrics';

export interface FaceSafeInput {
  /**
   * The extent the cut is allowed to reach, in the overlay buffer's own
   * pixels — `{0, 0, width, height}` bounds it to the overlay itself.
   */
  target: { left: number; top: number; width: number; height: number };
  /**
   * The protected box, also in overlay-buffer pixels. `Placement.faceOnCanvas`
   * is canvas space, so the caller subtracts the overlay's canvas origin on the
   * way in (see imageCompositor.ts, which is the only caller that has both).
   */
  face: Rect;
  /** §12 `faceProtectStrength`: 1 removes the overlay completely over the face */
  strength: number;
}

/** §8.2: the feathered band that restores the overlay is 20 % of the face box. */
const FEATHER = 0.2;

export async function protectFace(overlay: Buffer, i: FaceSafeInput): Promise<Buffer> {
  const strength = Math.min(1, Math.max(0, i.strength));
  if (strength <= 0) return overlay;
  if (i.face.width <= 0 || i.face.height <= 0) return overlay;   // no face derived: nothing to protect

  const cx = i.face.x + i.face.width / 2;
  const cy = i.face.y + i.face.height / 2;
  const halfX = i.face.width / 2 * (1 + FEATHER);
  const halfY = i.face.height / 2 * (1 + FEATHER);

  // The only pixels the falloff can touch, clipped to the slot so a face at the
  // edge of a figure cannot dim the frame art standing next to it.
  const left = Math.max(i.target.left, Math.floor(cx - halfX));
  const top = Math.max(i.target.top, Math.floor(cy - halfY));
  const right = Math.min(i.target.left + i.target.width, Math.ceil(cx + halfX));
  const bottom = Math.min(i.target.top + i.target.height, Math.ceil(cy + halfY));
  if (right <= left || bottom <= top) return overlay;

  const { data, info } = await sharp(overlay)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const rx = i.face.width / 2;
  const ry = i.face.height / 2;

  for (let y = top; y < bottom; y++) {
    const dy = (y + 0.5 - cy) / ry;
    for (let x = left; x < right; x++) {
      const dx = (x + 0.5 - cx) / rx;
      const rho = Math.sqrt(dx * dx + dy * dy);
      const w = Math.max(0, 1 - rho / (1 + FEATHER));
      if (w <= 0) continue;
      const p = (y * info.width + x) * channels;
      data[p + channels - 1] = Math.round(data[p + channels - 1] * (1 - strength * w));
    }
  }

  return sharp(Buffer.from(data), { raw: { width: info.width, height: info.height, channels } }).png().toBuffer();
}
