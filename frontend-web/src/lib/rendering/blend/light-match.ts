/**
 * Colour and lighting match (spec §6 B): measure, then move part of the way.
 *
 * Three terms, each bounded twice — once by the clamp in §6.3 and once by the
 * fraction of it that is actually applied — because the failure this pass
 * exists to prevent is the other one: a subject welded to its backdrop until it
 * looks like a different person wearing the frame's white balance. So the
 * numbers that leave here are the *targets*, and every pixel write carries the
 * applied fraction, which is what lets the job ledger in §14.5 distinguish
 * "matched by 8 %" from "matched by 45 % of 8 %".
 *
 * The measurements are the interesting half:
 *
 * - §6.1 counts only pixels at `alpha >= 200`. An average over a cutout's
 *   transparent border is an average of black, and the correction that follows
 *   from it brightens the subject into a grey smudge.
 * - §6.2 points the reference at the *neighbourhood* of the placement, not the
 *   frame average, and that rect arrives from the caller — Task 9 measures it
 *   once and passes the value in, so a template is decoded once per job rather
 *   than once per stage. `measureRegion` answers null below 64 opaque pixels,
 *   which is how "there is nothing around the slot to match" is detected
 *   instead of guessed at.
 * - contrast spread is the p90 − p10 of a 256-bin luma histogram (§6.1's
 *   percentiles), not a variance: two passes over the pixels, no float array the
 *   size of the image, and a number an operator can read as "this frame spans
 *   60 levels".
 *
 * Alpha is copied, never scaled — the matte's identity survives this stage so
 * the grounding and the encoder downstream see the silhouette §5 produced. And
 * G is excluded from the temperature term by construction: a gain on R and B
 * about a fixed G can warm or cool skin, it cannot rotate its hue.
 */
import sharp from 'sharp';
import type { Rect } from './subject-metrics';
import type { BlendParams } from './params';

/** §6.1 — "solid enough to be the subject's own colour". */
const OPAQUE_ALPHA = 200;
/** §6.2 — below this the neighbourhood is not a reference, it is noise. */
const MIN_REFERENCE_PIXELS = 64;
/** Rec.709 weights on the sRGB codes, the one convention §6.1 states. */
const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

export interface RegionStats {
  meanLuma: number;
  meanR: number;
  meanG: number;
  meanB: number;
  /** p90 − p10 of the luma histogram (§6.1's contrast spread). */
  spread: number;
  pixels: number;
}

export interface AppliedLight {
  subjectLuma: number;
  refLuma: number;
  /** the clamped target gain; the pixels saw `1 + lumaFraction * (gain - 1)`. */
  gain: number;
  temperature: { r: number; b: number };
  contrast: number;
  clamped: string[];
}

interface Raw {
  data: Buffer;
  width: number;
  height: number;
}

async function decode(png: Buffer): Promise<Raw> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width as number, height: info.height as number };
}

/**
 * Stats over the opaque pixels of `rect` (whole image when null). `hist` is the
 * 256-bin luma histogram the percentile walk below reads.
 */
interface Accumulator {
  r: number; g: number; b: number; luma: number; pixels: number; hist: Uint32Array;
}

function emptyAccumulator(): Accumulator {
  return { r: 0, g: 0, b: 0, luma: 0, pixels: 0, hist: new Uint32Array(256) };
}

function accumulate(raw: Raw, rect: Rect | null): Accumulator {
  const acc = emptyAccumulator();
  const { data, width } = raw;
  const x0 = rect ? Math.max(0, rect.x) : 0;
  const x1 = rect ? Math.min(width - 1, rect.x + rect.width - 1) : width - 1;
  const y0 = rect ? Math.max(0, rect.y) : 0;
  const y1 = rect ? Math.min(raw.height - 1, rect.y + rect.height - 1) : raw.height - 1;
  if (x1 < x0 || y1 < y0) return acc;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const p = (y * width + x) * 4;
      if (data[p + 3] < OPAQUE_ALPHA) continue;
      const l = luma(data[p], data[p + 1], data[p + 2]);
      acc.r += data[p];
      acc.g += data[p + 1];
      acc.b += data[p + 2];
      acc.luma += l;
      acc.hist[Math.max(0, Math.min(255, Math.round(l)))]++;
      acc.pixels++;
    }
  }
  return acc;
}

function finish(acc: Accumulator): RegionStats {
  const n = acc.pixels;
  return {
    meanLuma: n ? acc.luma / n : 0,
    meanR: n ? acc.r / n : 0,
    meanG: n ? acc.g / n : 0,
    meanB: n ? acc.b / n : 0,
    spread: n ? percentile(acc.hist, n, 0.9) - percentile(acc.hist, n, 0.1) : 0,
    pixels: n,
  };
}

const luma = (r: number, g: number, b: number) => LUMA_R * r + LUMA_G * g + LUMA_B * b;

/** Nearest-rank percentile over the histogram. */
function percentile(hist: Uint32Array, total: number, fraction: number): number {
  const rank = Math.max(0, Math.ceil(fraction * total) - 1);
  let seen = 0;
  for (let v = 0; v < 256; v++) {
    seen += hist[v];
    if (seen > rank) return v;
  }
  return 255;
}

/** §6.2's reference measurement, answered null when there is nothing to match. */
export async function measureRegion(png: Buffer, rect: Rect): Promise<RegionStats | null> {
  const stats = finish(accumulate(await decode(png), rect));
  return stats.pixels < MIN_REFERENCE_PIXELS ? null : stats;
}

/** §6.1's subject measurement, over every opaque pixel in the frame. */
export async function measureSubjectLight(png: Buffer): Promise<RegionStats> {
  return finish(accumulate(await decode(png), null));
}

/**
 * The three terms of §6.3, then one write loop.
 *
 * `ref === null` (or too thin to trust) is not a neutral case, it is the absent
 * case: the buffer comes back as the very object handed in, not re-encoded, so
 * an unlit template changes nothing at all downstream — including the bytes.
 */
export async function matchLight(
  subject: Buffer,
  subjectStats: RegionStats,
  ref: RegionStats | null,
  params: BlendParams,
): Promise<{ png: Buffer; applied: AppliedLight }> {
  const identity: AppliedLight = {
    subjectLuma: subjectStats.meanLuma,
    refLuma: ref?.meanLuma ?? 0,
    gain: 1,
    temperature: { r: 1, b: 1 },
    contrast: 1,
    clamped: [],
  };
  if (!ref || ref.pixels < MIN_REFERENCE_PIXELS || subjectStats.pixels === 0 || subjectStats.meanLuma <= 0) {
    return { png: subject, applied: identity };
  }

  const clamped: string[] = [];

  // Luminance: match the frame's luma, biased by the preset, then keep only a
  // fraction of the move.
  const wantedGain = (params.lumaBias * ref.meanLuma) / subjectStats.meanLuma;
  const gain = clamp(wantedGain, params.gainMin, params.gainMax);
  if (gain !== wantedGain) clamped.push('gain');
  const kLuma = 1 + params.lumaFraction * (gain - 1);

  // Temperature: a gain on R and B about the frame's warmth ratio, never a hue
  // rotation, and G is deliberately absent from this term.
  const subjectWarmth = subjectStats.meanB > 0 ? subjectStats.meanR / subjectStats.meanB : 0;
  const refWarmth = ref.meanB > 0 ? ref.meanR / ref.meanB : 0;
  let deltaTemp = 0;
  if (subjectWarmth > 0 && refWarmth > 0) {
    const wantedTemp = refWarmth / subjectWarmth - 1;
    deltaTemp = clamp(wantedTemp, -params.tempMax, params.tempMax);
    if (deltaTemp !== wantedTemp) clamped.push('temperature');
  }
  const kR = 1 + params.lumaFraction * deltaTemp;
  const kB = 1 + params.lumaFraction * -deltaTemp;

  // Contrast: rescale the spread toward the frame's, around the subject's own
  // means so nothing clips to black or white. A flat subject has no spread to
  // rescale, and dividing by it would invent a correction.
  let slope = 1;
  if (subjectStats.spread > 0 && ref.spread > 0) {
    const wantedContrast = ref.spread / subjectStats.spread - 1;
    const contrast = clamp(wantedContrast, -params.contrastMax, params.contrastMax);
    if (contrast !== wantedContrast) clamped.push('contrast');
    slope = 1 + params.lumaFraction * contrast;
  }

  const raw = await decode(subject);
  const out = Buffer.alloc(raw.data.length);
  for (let p = 0; p < raw.data.length; p += 4) {
    const a = raw.data[p + 3];
    out[p] = channel(raw.data[p], subjectStats.meanR, slope, kLuma * kR);
    out[p + 1] = channel(raw.data[p + 1], subjectStats.meanG, slope, kLuma);
    out[p + 2] = channel(raw.data[p + 2], subjectStats.meanB, slope, kLuma * kB);
    out[p + 3] = a;                                      // the matte is not a colour
  }
  const png = await sharp(out, { raw: { width: raw.width, height: raw.height, channels: 4 } }).png().toBuffer();
  return {
    png,
    applied: { subjectLuma: subjectStats.meanLuma, refLuma: ref.meanLuma, gain, temperature: { r: kR, b: kB }, contrast: slope, clamped },
  };
}

/** `linear` around the region's own mean, then the gain, clamped to 8 bits. */
function channel(value: number, mean: number, slope: number, gain: number): number {
  const contrasted = mean + slope * (value - mean);
  return Math.round(Math.min(255, Math.max(0, contrasted * gain)));
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
