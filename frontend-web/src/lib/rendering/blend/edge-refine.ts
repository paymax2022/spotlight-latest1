/**
 * Edge refinement (spec §5): defringe, despeckle, close holes, feather.
 *
 * Four passes over the cutout's raw RGBA, in the order the spec numbers them.
 * Each one is *measured* before it acts, because every pass here can make a
 * good cutout worse and none of them has a user watching to say so:
 *
 * - **Defringe (§5.1)** unmixes the vendor's leftover background colour out of
 *   the pixels the matte already declares to be mixed. The colour is the median
 *   of the low-alpha pixels in a ring around the subject's bounding box — that
 *   band is what the segmentation left behind — and if fewer than 64 such
 *   pixels exist the pass declines to run: a cutout with no residual background
 *   must not be "fixed" by amplifying encoder noise by 1/a. Fully opaque and
 *   fully transparent pixels are untouched, which is what keeps clothing
 *   texture and the interior of the subject byte-identical.
 * - **Despeckle (§5.2)** keeps the largest connected component and zeroes small
 *   ones: a floating patch of background colour is worse than a missing hair
 *   wisp, so the size threshold is the preset's, not a guess made here.
 * - **Holes** are the mirror image — a low-alpha region inside the bbox that an
 *   exterior flood fill cannot reach, and that is smaller than `holeMaxArea`,
 *   is a segmentation miss rather than a see-through gap.
 * - **Feather (§5.3)** blurs the *alpha channel alone*, with a radius capped
 *   against the slot the subject is drawn into. Softening a matte edge cannot
 *   smudge skin because no RGB byte passes through this blur at all.
 *
 * Both §5.2 fills are iterative-stack flood fills over typed arrays rather than
 * libvips `dilate`/`erode`, exactly as §5.2 says: the §2 probe found morphology
 * on a single-band raw input promotes the result to three channels, and that
 * band bookkeeping costs more clarity than forty lines of fill cost correctness.
 *
 * Nothing here throws for an unusual image. A buffer with no matte pixels is not
 * an error, it is the empty-subject case, and it comes back unchanged with a
 * ledger of zeros; an undecodable buffer re-throws, because the runner already
 * turns a throw into a failed job carrying the message an operator needs.
 */
import sharp from 'sharp';
import type { BlendParams } from './params';

/** §5.2 — "this pixel belongs to the subject". */
const MATTE_ALPHA = 8;
/** §5.1 — "this pixel is still the old background, sample it". */
const BACKGROUND_ALPHA = 32;
/** Width of the sampling ring around the bbox, as a fraction of its smaller side. */
const BACKGROUND_RING_SHARE = 0.12;
/** Below this many samples the median is noise, so the defringe declines to run. */
const BACKGROUND_MIN_SAMPLES = 64;
/** A closed hole borrows its colour from neighbours this solid. */
const OPAQUE_ALPHA = 200;
/** §5.3 — the feather ceiling is a fraction of the slot's smaller side… */
const FEATHER_SLOT_SHARE = 0.004;
/** …and the radius never exceeds 2 however large the slot is. */
const FEATHER_MAX_RADIUS = 2;

export interface EdgeApplied {
  fringePixels: number;
  droppedComponents: number;
  closedHoles: number;
  featherPx: number;
}

/** Inclusive bounds, because every walk below tests `<= x1`. */
interface BBox { x0: number; y0: number; x1: number; y1: number }

export async function refineEdges(
  png: Buffer,
  params: BlendParams,
  slot: { width: number; height: number },
): Promise<{ png: Buffer; applied: EdgeApplied }> {
  const { data: rgba, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = info.width as number;
  const height = info.height as number;
  const applied: EdgeApplied = { fringePixels: 0, droppedComponents: 0, closedHoles: 0, featherPx: 0 };

  const alpha = alphaOf(rgba);
  const bbox = matteBBox(alpha, width, height);
  if (!bbox) return { png, applied };                 // empty matte: nothing to refine

  fringe(rgba, alpha, width, height, bbox, applied);
  dropSpeckles(alpha, width, height, params.speckleMinArea, applied);
  closeHoles(rgba, alpha, width, bbox, params.holeMaxArea, applied);

  const radius = featherRadius(params.featherPx, slot);
  applied.featherPx = radius;
  const blurred = radius > 0 ? boxBlurAlpha(alpha, width, height, radius) : alpha;

  // RGB from `rgba` (defringed in place), alpha from `blurred`: the two passes
  // never write to the same array, which is how §5.3's "never to RGB" holds.
  const out = Buffer.alloc(rgba.length);
  for (let i = 0, p = 0; p < out.length; i++, p += 4) {
    out[p] = rgba[p];
    out[p + 1] = rgba[p + 1];
    out[p + 2] = rgba[p + 2];
    out[p + 3] = blurred[i];
  }
  const encoded = await sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return { png: encoded, applied };
}

/**
 * §5.3 verbatim: `min(preset.featherPx, max(1, round(min(slotW, slotH) × 0.004)))`,
 * with the same section's radius limit of 2 applied on top. The `max(1, …)`
 * inside the cap means a slot narrower than 250 px lands on exactly one pixel
 * of blur, and `off`'s 0 stays 0 in any slot: the cap is a ceiling on what the
 * preset asked for, never a floor under it.
 */
export function featherRadius(presetFeather: number, slot: { width: number; height: number }): number {
  const wanted = Math.max(0, Math.round(presetFeather));
  const cap = Math.max(1, Math.round(Math.min(slot.width, slot.height) * FEATHER_SLOT_SHARE));
  return Math.min(wanted, cap, FEATHER_MAX_RADIUS);
}

function alphaOf(rgba: Buffer): Uint8Array {
  const a = new Uint8Array(rgba.length >> 2);
  for (let i = 0, p = 3; i < a.length; i++, p += 4) a[i] = rgba[p];
  return a;
}

function matteBBox(alpha: Uint8Array, width: number, height: number): BBox | null {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (alpha[row + x] < MATTE_ALPHA) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/**
 * The unmix of §5.1: `c' = (c − (1 − a)·bg) / a`, clamped to [0, 255]. It runs
 * only where the matte already says the pixel is a blend, so it can neither
 * reach the subject's own colours nor resurrect a transparent pixel, and
 * `fringePixels` counts what it touched so the ledger can say "nothing to do".
 */
function fringe(
  rgba: Buffer,
  alpha: Uint8Array,
  width: number,
  height: number,
  bbox: BBox,
  applied: EdgeApplied,
): void {
  const bg = backgroundColour(rgba, alpha, width, height, bbox);
  if (!bg) return;
  for (let i = 0, p = 0; i < alpha.length; i++, p += 4) {
    const a = alpha[i] / 255;
    if (!(a > 0 && a < 1)) continue;
    for (let c = 0; c < 3; c++) {
      const un = (rgba[p + c] - (1 - a) * bg[c]) / a;
      rgba[p + c] = Math.round(Math.min(255, Math.max(0, un)));
    }
    applied.fringePixels++;
  }
}

/**
 * Channel-wise median of the low-alpha pixels lying in the ring just outside
 * the bbox — the band the segmentation left behind. Null when the ring is too
 * thin to trust, which is this pass saying "there is no residual background
 * here, so there is nothing to unmix".
 */
function backgroundColour(
  rgba: Buffer,
  alpha: Uint8Array,
  width: number,
  height: number,
  bbox: BBox,
): [number, number, number] | null {
  const span = Math.min(bbox.x1 - bbox.x0 + 1, bbox.y1 - bbox.y0 + 1);
  const margin = Math.max(1, Math.round(span * BACKGROUND_RING_SHARE));
  const rx0 = Math.max(0, bbox.x0 - margin);
  const rx1 = Math.min(width - 1, bbox.x1 + margin);
  const ry0 = Math.max(0, bbox.y0 - margin);
  const ry1 = Math.min(height - 1, bbox.y1 + margin);
  const r: number[] = [];
  const g: number[] = [];
  const b: number[] = [];
  for (let y = ry0; y <= ry1; y++) {
    for (let x = rx0; x <= rx1; x++) {
      if (x >= bbox.x0 && x <= bbox.x1 && y >= bbox.y0 && y <= bbox.y1) continue;
      const i = y * width + x;
      if (alpha[i] >= BACKGROUND_ALPHA) continue;
      const p = i * 4;
      r.push(rgba[p]);
      g.push(rgba[p + 1]);
      b.push(rgba[p + 2]);
    }
  }
  if (r.length < BACKGROUND_MIN_SAMPLES) return null;
  return [median(r), median(g), median(b)];
}

function median(values: number[]): number {
  const sorted = values.slice().sort((x, y) => x - y);
  return sorted[sorted.length >> 1];
}

/**
 * §5.2's first half: one flood fill over `alpha >= MATTE_ALPHA`, then every
 * component smaller than the threshold is zeroed — except the largest, which is
 * the subject and survives whatever its size, because a preset with a big
 * threshold must not delete the only thing in the frame.
 *
 * Only alpha is zeroed. The RGB stays, so a later read of the fringe ring — or
 * a re-run with a gentler threshold — still sees the colours the vendor left.
 */
function dropSpeckles(
  alpha: Uint8Array,
  width: number,
  height: number,
  minArea: number,
  applied: EdgeApplied,
): void {
  if (minArea <= 0) return;                            // preset asks for no despeckle
  const total = width * height;
  const label = new Int32Array(total).fill(-1);
  const stack = new Int32Array(total);
  const areas: number[] = [];
  for (let seed = 0; seed < total; seed++) {
    if (label[seed] >= 0 || alpha[seed] < MATTE_ALPHA) continue;
    const id = areas.length;
    let top = 0;
    let area = 0;
    label[seed] = id;
    stack[top++] = seed;
    while (top > 0) {
      const i = stack[--top];
      area++;
      const x = i % width;
      if (x > 0) { const n = i - 1; if (label[n] < 0 && alpha[n] >= MATTE_ALPHA) { label[n] = id; stack[top++] = n; } }
      if (x < width - 1) { const n = i + 1; if (label[n] < 0 && alpha[n] >= MATTE_ALPHA) { label[n] = id; stack[top++] = n; } }
      if (i >= width) { const n = i - width; if (label[n] < 0 && alpha[n] >= MATTE_ALPHA) { label[n] = id; stack[top++] = n; } }
      if (i < total - width) { const n = i + width; if (label[n] < 0 && alpha[n] >= MATTE_ALPHA) { label[n] = id; stack[top++] = n; } }
    }
    areas.push(area);
  }

  let largest = 0;
  for (let id = 1; id < areas.length; id++) if (areas[id] > areas[largest]) largest = id;
  const doomed = new Uint8Array(areas.length);
  let dropped = 0;
  for (let id = 0; id < areas.length; id++) {
    if (id !== largest && areas[id] < minArea) { doomed[id] = 1; dropped++; }
  }
  if (dropped) {
    for (let i = 0; i < total; i++) {
      const id = label[i];
      if (id >= 0 && doomed[id]) alpha[i] = 0;
    }
  }
  applied.droppedComponents = dropped;
}

/**
 * §5.2's second half. The exterior is every low-alpha cell reachable from the
 * bbox's own border, which is also what implements "not touching the bbox
 * edge": a gap that leaks to the border is part of the silhouette's outline,
 * not a hole. What the exterior fill cannot reach, and is smaller than the
 * preset's area, is filled to opaque and recoloured from the solid pixels
 * around it, so a closed patch reads as skin rather than as a black pinprick.
 */
function closeHoles(
  rgba: Buffer,
  alpha: Uint8Array,
  width: number,
  bbox: BBox,
  maxArea: number,
  applied: EdgeApplied,
): void {
  if (maxArea <= 0) return;                            // preset asks for no hole closing
  const state = new Uint8Array(alpha.length);          // 1 = reachable background, 2 = enclosed
  const nb = new Int32Array(4);
  const stack: number[] = [];

  // Seed the exterior from the bbox border, then walk inward. Bounding the walk
  // to the bbox is deliberate: everything outside it is background by
  // definition, so a full-frame fill would cost a pass over the whole canvas to
  // learn nothing.
  for (let x = bbox.x0; x <= bbox.x1; x++) {
    for (const y of [bbox.y0, bbox.y1]) seed(y * width + x);
  }
  for (let y = bbox.y0; y <= bbox.y1; y++) {
    for (const x of [bbox.x0, bbox.x1]) seed(y * width + x);
  }
  function seed(i: number): void {
    if (state[i] || alpha[i] >= MATTE_ALPHA) return;
    state[i] = 1;
    stack.push(i);
  }
  while (stack.length) {
    const i = stack.pop() as number;
    const n = neighbours(nb, i, bbox, width);
    for (let k = 0; k < n; k++) {
      const j = nb[k];
      if (state[j] || alpha[j] >= MATTE_ALPHA) continue;
      state[j] = 1;
      stack.push(j);
    }
  }

  for (let y = bbox.y0; y <= bbox.y1; y++) {
    for (let x = bbox.x0; x <= bbox.x1; x++) {
      const seedIndex = y * width + x;
      if (state[seedIndex] || alpha[seedIndex] >= MATTE_ALPHA) continue;   // solid, or reachable background
      const region = enclosedRegion(state, seedIndex, bbox, width, alpha);
      if (region.length === 0 || region.length >= maxArea) continue;
      const colour = ringColour(rgba, alpha, region, bbox, width, nb);
      for (const i of region) {
        alpha[i] = 255;
        if (colour) {
          rgba[i * 4] = colour[0];
          rgba[i * 4 + 1] = colour[1];
          rgba[i * 4 + 2] = colour[2];
        }
      }
      applied.closedHoles++;
    }
  }
}

/** Flood fill one enclosed region, marking it so the outer scan never revisits it. */
function enclosedRegion(
  state: Uint8Array,
  seedIndex: number,
  bbox: BBox,
  width: number,
  alpha: Uint8Array,
): number[] {
  const nb = new Int32Array(4);
  const region = [seedIndex];
  state[seedIndex] = 2;
  for (let head = 0; head < region.length; head++) {
    const i = region[head];
    const n = neighbours(nb, i, bbox, width);
    for (let k = 0; k < n; k++) {
      const j = nb[k];
      if (state[j] || alpha[j] >= MATTE_ALPHA) continue;
      state[j] = 2;
      region.push(j);
    }
  }
  return region;
}

/** Write the in-bbox orthogonal neighbours of `i` into `out`; return how many. */
function neighbours(out: Int32Array, i: number, bbox: BBox, width: number): number {
  const x = i % width;
  let n = 0;
  if (x > bbox.x0) out[n++] = i - 1;
  if (x < bbox.x1) out[n++] = i + 1;
  if (i - width >= bbox.y0 * width) out[n++] = i - width;
  if (i + width <= bbox.y1 * width + bbox.x1) out[n++] = i + width;
  return n;
}

/** Mean RGB of the solid pixels bordering a hole, or null when there are none. */
function ringColour(
  rgba: Buffer,
  alpha: Uint8Array,
  region: number[],
  bbox: BBox,
  width: number,
  nb: Int32Array,
): [number, number, number] | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const i of region) {
    const count = neighbours(nb, i, bbox, width);
    for (let k = 0; k < count; k++) {
      const j = nb[k];
      if (alpha[j] < OPAQUE_ALPHA) continue;
      const p = j * 4;
      r += rgba[p];
      g += rgba[p + 1];
      b += rgba[p + 2];
      n++;
    }
  }
  return n ? [Math.round(r / n), Math.round(g / n), Math.round(b / n)] : null;
}

/**
 * Separable box blur on the alpha channel, radius ≤ 2 (§5.3). Anything outside
 * the image counts as transparent, so the blur can never brighten an edge that
 * touches the frame.
 */
function boxBlurAlpha(alpha: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const horizontal = new Uint8Array(alpha.length);
  const vertical = new Uint8Array(alpha.length);
  const span = radius * 2 + 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const nx = x + k;
        sum += nx >= 0 && nx < width ? alpha[row + nx] : 0;
      }
      horizontal[row + x] = Math.round(sum / span);
    }
  }
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        const ny = y + k;
        sum += ny >= 0 && ny < height ? horizontal[ny * width + x] : 0;
      }
      vertical[row + x] = Math.round(sum / span);
    }
  }
  return vertical;
}
