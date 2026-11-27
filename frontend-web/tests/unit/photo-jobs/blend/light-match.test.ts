/**
 * P2 Task 6 — colour and lighting match (spec §6 B).
 *
 * This is the task where §6.B's "the same dial, not the same filter" is
 * proved: two contestants in the same frame get two different numbers, each
 * derived from its own measurement, and every number is reported so §14.5 can
 * tell "matched by 8 %" from "matched by 45 % of 8 %".
 *
 * The fixtures are chosen so each of §6.3's three terms can be isolated:
 *
 * - `strip` (5 000 px at 100, 5 000 px at 160) has a mean luma of exactly 130
 *   and a p10/p90 spread of exactly 60, so a reference with the same spread
 *   makes the contrast term a demonstrable no-op instead of an untestable one;
 * - a neutral reference (R = G = B) makes the temperature term zero, and a flat
 *   warm subject against a flat neutral reference makes the *luminance* term
 *   near-zero while the temperature term is pinned at its clamp;
 * - `alpha === 0` pixels are in every fixture, because "only opaque ones" is
 *   the half of §6.1 that a naive average gets wrong.
 */
import { describe, expect, it } from 'vitest';
import { matchLight, measureRegion, measureSubjectLight } from '@/src/lib/rendering/blend/light-match';
import type { RegionStats } from '@/src/lib/rendering/blend/light-match';
import { resolveBlendParams } from '@/src/lib/rendering/blend/params';
import { countAlpha, flatPng, pixelAt, rawRgba, rgbaPng } from './fixtures';

const natural = resolveBlendParams('natural');   // lumaFraction .45 bias .97 gain .92-1.08 tempMax .04 contrastMax .06
const LUMA = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** 100x100, half at luma 100 and half at luma 160: mean 130, spread exactly 60. */
const strip = () => rgbaPng(100, 100, (x) => {
  const v = x < 50 ? 100 : 160;
  return { r: v, g: v, b: v, a: 255 };
});
/** Mean luma over the opaque pixels, computed here so the test owns the convention. */
async function meanLuma(png: Buffer): Promise<number> {
  const { data } = await rawRgba(png);
  let s = 0;
  let n = 0;
  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3] < 200) continue;
    s += LUMA(data[p], data[p + 1], data[p + 2]);
    n++;
  }
  return n ? s / n : 0;
}
async function meanChannels(png: Buffer) {
  const { data } = await rawRgba(png);
  let r = 0, g = 0, b = 0, n = 0;
  for (let p = 0; p < data.length; p += 4) {
    if (data[p + 3] < 200) continue;
    r += data[p]; g += data[p + 1]; b += data[p + 2]; n++;
  }
  return { r: r / n, g: g / n, b: b / n };
}
/** Luv-style hue angle, the thing §6.3 forbids this pass from rotating. */
const hue = (c: { r: number; g: number; b: number }) =>
  Math.atan2(1.732 * (c.g - c.b), 2 * c.r - c.g - c.b) * (180 / Math.PI);
const NEUTRAL_140: RegionStats = {
  meanLuma: 140, meanR: 140, meanG: 140, meanB: 140, spread: 60, pixels: 5000,
};

describe('matchLight', () => {
  it('moves the subject part of the way toward the reference, by its own amount', async () => {
    const subject = await strip();
    const stats = await measureSubjectLight(subject);
    expect(stats.meanLuma).toBeCloseTo(130, 6);
    expect(stats.spread).toBe(60);                       // p90 160 - p10 100, §6.1's contrast spread

    const { png, applied } = await matchLight(subject, stats, NEUTRAL_140, natural);
    // gain = 0.97 * 140 / 130 = 1.04461, inside natural's +-8 %, and applied at 45 %.
    expect(applied.gain).toBeCloseTo(0.97 * 140 / 130, 6);
    expect(applied.clamped).toEqual([]);
    expect(applied.contrast).toBe(1);                    // equal spreads -> no rescale
    expect(applied.temperature).toEqual({ r: 1, b: 1 }); // neutral reference
    const k = 1 + 0.45 * (applied.gain - 1);
    expect(await meanLuma(png)).toBeCloseTo(130 * k, 0);
    expect(png).not.toBe(subject);                       // a rendered image, not the input
    expect(await pixelAt(png, 0, 0)).toMatchObject({ a: 255 });
  });

  it('gives a second subject a different number for the same frame', async () => {
    const half = () => rgbaPng(100, 100, (x) => {
      const v = x < 50 ? 60 : 120;
      return { r: v, g: v, b: v, a: 255 };
    });
    const subject = await half();
    const stats = await measureSubjectLight(subject);
    expect(stats.meanLuma).toBeCloseTo(90, 6);           // a darker contestant, same frame
    const { png, applied } = await matchLight(subject, stats, NEUTRAL_140, natural);
    expect(applied.gain).toBe(1.08);                     // 1.509 wanted, gainMax bound
    expect(applied.clamped).toEqual(['gain']);
    expect(await meanLuma(png)).toBeCloseTo(90 * (1 + 0.45 * 0.08), 0);   // 93.2, not 135.8
  });

  it('tilts R and B toward the frame without rotating hue past tempMax', async () => {
    const subject = await flatPng(100, 100, { r: 200, g: 150, b: 100, a: 255 });
    const stats = await measureSubjectLight(subject);
    const cool: RegionStats = { meanLuma: 162, meanR: 120, meanG: 145, meanB: 180, spread: 0, pixels: 5000 };
    const { png, applied } = await matchLight(subject, stats, cool, natural);
    // (120/180) / (200/100) - 1 = -0.667 wanted, clamped to -tempMax, then taken at 45 %.
    expect(applied.temperature.r).toBeCloseTo(1 - 0.45 * 0.04, 6);
    expect(applied.temperature.b).toBeCloseTo(1 + 0.45 * 0.04, 6);
    expect(applied.clamped).toEqual(['temperature']);
    const before = await meanChannels(subject);
    const after = await meanChannels(png);
    expect(after.r).toBeLessThan(before.r);
    expect(after.b).toBeGreaterThan(before.b);
    expect(after.g).toBeCloseTo(before.g, 0);            // G never enters the temperature term
    expect(Math.abs(hue(after) - hue(before))).toBeLessThan(3);   // §6.3's skin-tone guard
  });

  it('does nothing at all when there is no reference region', async () => {
    const subject = await strip();
    const { png, applied } = await matchLight(subject, await measureSubjectLight(subject), null, natural);
    expect(applied).toMatchObject({ gain: 1, contrast: 1, refLuma: 0, clamped: [] });
    expect(applied.temperature).toEqual({ r: 1, b: 1 });
    expect(png).toBe(subject);                           // not even re-encoded
    expect(await meanLuma(png)).toBeCloseTo(130, 6);
  });
});

describe('measureRegion', () => {
  it('measures the rect it is pointed at, and only the opaque pixels', async () => {
    const png = await rgbaPng(100, 100, (x) => (x < 50 ? { r: 255, g: 0, b: 0, a: 255 } : { r: 0, g: 0, b: 0, a: 0 }));
    expect(await countAlpha(png, (a) => a === 0)).toBe(5000);
    const left = await measureRegion(png, { x: 0, y: 0, width: 50, height: 100 });
    expect(left).toMatchObject({ meanR: 255, meanG: 0, meanB: 0, pixels: 5000, spread: 0 });
    expect(left?.meanLuma).toBeCloseTo(LUMA(255, 0, 0), 6);
    // Half the rect is transparent: the mean stays the red value, not a blend toward black.
    const straddle = await measureRegion(png, { x: 25, y: 0, width: 50, height: 100 });
    expect(straddle).toMatchObject({ meanR: 255, pixels: 2500 });
    expect(await measureRegion(png, { x: 50, y: 0, width: 50, height: 100 })).toBeNull();
    // §6.2's floor: a handful of stray pixels is not a reference worth matching.
    const specks = await rgbaPng(100, 100, (x, y) => (x < 7 && y < 7 ? { r: 20, g: 40, b: 80, a: 255 } : { r: 0, g: 0, b: 0, a: 0 }));
    expect(await measureRegion(specks, { x: 0, y: 0, width: 100, height: 100 })).toBeNull();
  });
});
