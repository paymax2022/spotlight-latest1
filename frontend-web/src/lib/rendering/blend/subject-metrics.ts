/**
 * Subject measurement (spec §8.1, §13).
 *
 * Everything the blend engine knows about a cutout comes from its own alpha
 * channel: where the silhouette is, how wide the head is, where the shoulders
 * start, and which rectangle a foreground overlay must never cover. Nothing
 * here looks at colour, and nothing here needs a face detector — the matte the
 * vendor returned is the authority, which is also why a bad matte is a visible,
 * attributable failure instead of a hidden one.
 *
 * Two conventions that the rest of the engine depends on:
 *
 * - a pixel counts as subject when `alpha >= ALPHA_TEST`. The threshold exists
 *   because background-removal vendors leave a faint halo around the figure; if
 *   any non-zero alpha bounded the subject, a soft 4 px wash would enlarge the
 *   bbox, and the placement would shrink the person to compensate.
 * - row runs are measured per scanline rather than by contour tracing. The
 *   questions being asked ("how wide is the top of the mass", "where does it
 *   step out to shoulders") are all about widths, and a run length is exact and
 *   stable in a way a traced polygon is not.
 *
 * The raw path is spelled out (`ensureAlpha()` then `raw()` with an explicit
 * channel count) because spec §2 records the trap: `extractChannel(3).toBuffer()`
 * hands back encoded PNG bytes while reporting `channels: 1`.
 */
import sharp from 'sharp';

export interface Rect { x: number; y: number; width: number; height: number }

export interface SubjectMetrics {
  /** the subject image's own pixel size */
  width: number;
  height: number;
  /** tight box over pixels counted as subject; all zero when there are none */
  bbox: Rect;
  /** the box a foreground overlay must keep clear (§8.2) */
  face: Rect;
  /** subject pixels / bbox area — a bust is dense, a full figure is not */
  coverage: number;
  /** y of the first row that is part of the subject */
  headTop: number;
  /** exclusive: first row whose run width > 1.2 * headWidth, else headTop + headWidth */
  headBottom: number;
  /** widest row run inside the top 12 % of the bbox */
  headWidth: number;
  /** first row below the head whose width >= 1.8 * headWidth */
  shoulderY: number | null;
  /** last row that is part of the subject */
  bottomY: number;
  /** bbox.height, named because spec §13 speaks of it */
  silhouetteHeight: number;
}

/** Below this, alpha is a vendor halo rather than the subject. */
const ALPHA_TEST = 8;
/** Rows considered when finding the head: spec §8.1's "top of the mass". */
const HEAD_SCAN_SHARE = 0.12;
/** A row this much wider than the head has left the head. */
const HEAD_END_STEP = 1.2;
/** A row this much wider than the head is a shoulder line. */
const SHOULDER_STEP = 1.8;
// The protected face box, spec §8.2. It is deliberately smaller than the head
// mass: the top of a head is hair, and a laurel crossing hair reads as depth.
const FACE_TOP_INSET = 0.06;
const FACE_HEIGHT_SHARE = 0.78;
const FACE_WIDTH_SHARE = 0.62;

export async function measureSubject(png: Buffer): Promise<SubjectMetrics> {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = info.width;
  const height = info.height;
  const channels = info.channels;
  const rowRun = new Int32Array(height);

  let minX = width, minY = height, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] < ALPHA_TEST) continue;
      rowRun[y]++;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (count === 0) {
    const empty: Rect = { x: 0, y: 0, width: 0, height: 0 };
    return {
      width, height, bbox: empty, face: empty, coverage: 0,
      headTop: 0, headBottom: 0, headWidth: 0, shoulderY: null, bottomY: 0, silhouetteHeight: 0,
    };
  }

  const bbox: Rect = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  const headTop = minY;
  const bottomY = maxY;

  let headWidth = 0;
  const headScanEnd = Math.min(maxY, minY + Math.max(1, Math.floor(bbox.height * HEAD_SCAN_SHARE)) - 1);
  for (let y = headTop; y <= headScanEnd; y++) headWidth = Math.max(headWidth, rowRun[y]);

  let headBottom = headTop + headWidth;
  for (let y = headTop + 1; y <= maxY; y++) {
    if (rowRun[y] > HEAD_END_STEP * headWidth) { headBottom = y; break; }
  }
  headBottom = Math.min(headBottom, maxY + 1);

  let shoulderY: number | null = null;
  for (let y = Math.max(headBottom, headTop + 1); y <= maxY; y++) {
    if (rowRun[y] >= SHOULDER_STEP * headWidth) { shoulderY = y; break; }
  }

  // Mean x of the head rows, so a subject leaning out of frame still gets a box
  // over its own face rather than over the canvas centre.
  let sumX = 0, sumN = 0;
  for (let y = headTop; y < Math.min(headBottom, maxY + 1); y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * channels + 3] >= ALPHA_TEST) { sumX += x; sumN++; }
    }
  }
  const centreX = sumN > 0 ? sumX / sumN : bbox.x + bbox.width / 2;
  const span = Math.max(1, headBottom - headTop);
  const faceWidth = Math.max(1, Math.round(FACE_WIDTH_SHARE * headWidth));
  const face: Rect = {
    x: Math.round(centreX - faceWidth / 2),
    y: Math.round(headTop + FACE_TOP_INSET * span),
    width: faceWidth,
    height: Math.max(1, Math.round(FACE_HEIGHT_SHARE * span)),
  };

  return {
    width,
    height,
    bbox,
    face,
    coverage: count / (bbox.width * bbox.height),
    headTop,
    headBottom,
    headWidth,
    shoulderY,
    bottomY,
    silhouetteHeight: bbox.height,
  };
}
