/**
 * P2 Task 5 — edge refinement (spec §5).
 *
 * Each case plants one defect and measures its removal, with two conventions
 * that keep the numbers exact:
 *
 * - the despeckle and hole cases resolve their preset with `featherPx: 0`,
 *   because a test that counts opaque pixels while also softening every matte
 *   edge cannot say which pass broke;
 * - the fringe fixture is a real 50 % blend of a known subject colour over a
 *   known background colour, so §5.1's unmix has an exact answer rather than a
 *   vibe: magenta (255,0,255) over green (0,255,0) at half coverage is the grey
 *   (128,128,128) at alpha 128, and unmixed it must come back as (255,~0,255).
 */
import { describe, expect, it } from 'vitest';
import { refineEdges } from '@/src/lib/rendering/blend/edge-refine';
import { resolveBlendParams } from '@/src/lib/rendering/blend/params';
import { alphaAt, countAlpha, pixelAt, rgbaPng } from './fixtures';

const natural = resolveBlendParams('natural');                      // feather 1, speckle 24, hole 24
const noFeather = resolveBlendParams('natural', { featherPx: 0 });  // same thresholds, no blur
const bold = resolveBlendParams('bold');                            // feather 2, speckle 6, hole 60
const off = resolveBlendParams('off');                              // feather 0, thresholds 0

/** A magenta disc on a green field, with a 50 % fringe ring at alpha 128. */
const fringeCutout = () => rgbaPng(60, 60, (x, y) => {
  const d = Math.hypot(x - 30, y - 30);
  if (d < 18) return { r: 255, g: 0, b: 255, a: 255 };
  if (d < 19) return { r: 128, g: 128, b: 128, a: 128 };            // 0.5 magenta + 0.5 green
  return { r: 0, g: 255, b: 0, a: 0 };
});
/** A 30x30 opaque patch (900 px) carrying either a 2x2 speckle or a 1 px hole. */
const patch = (defect: 'speckle' | 'hole') => rgbaPng(60, 60, (x, y) => {
  if (defect === 'speckle' && x >= 50 && x < 52 && y >= 50 && y < 52) return { r: 9, g: 9, b: 9, a: 255 };
  const inPatch = x >= 10 && x < 40 && y >= 10 && y < 40;
  if (defect === 'hole' && x === 20 && y === 20) return { r: 0, g: 0, b: 0, a: 0 };
  return inPatch ? { r: 200, g: 160, b: 130, a: 255 } : { r: 0, g: 0, b: 0, a: 0 };
});
const opaqueArea = (png: Buffer) => countAlpha(png, (a) => a >= 200);

describe('refineEdges', () => {
  it('unmixes the residual background out of the fringe and leaves the core alone', async () => {
    const { png, applied } = await refineEdges(await fringeCutout(), natural, { width: 300, height: 400 });
    expect(applied.fringePixels).toBeGreaterThan(0);
    expect((await pixelAt(png, 30, 30)).rgb).toEqual([255, 0, 255]);        // alpha 255: untouched
    const ring = (await pixelAt(png, 48, 30)).rgb;                          // d === 18.0 -> the ring
    expect(ring[0]).toBeGreaterThan(200);                                   // was 128
    expect(ring[1]).toBeLessThan(40);                                       // was 128 of green halo
    expect(ring[2]).toBeGreaterThan(200);
  });

  it('drops a stray speckle and keeps the body', async () => {
    const { png, applied } = await refineEdges(await patch('speckle'), noFeather, { width: 300, height: 400 });
    expect(applied.droppedComponents).toBe(1);
    expect(await alphaAt(png, 50, 50)).toBe(0);
    expect(await opaqueArea(png)).toBe(900);                                // exactly the 30x30 patch
  });

  it('closes a hole inside the body', async () => {
    const { png, applied } = await refineEdges(await patch('hole'), noFeather, { width: 300, height: 400 });
    expect(applied.closedHoles).toBe(1);
    expect(await alphaAt(png, 20, 20)).toBeGreaterThanOrEqual(200);
    expect(await opaqueArea(png)).toBe(900);                                // the patch is whole again
  });

  it('takes the feather cap from the slot and never feathers a preset that asked for none', async () => {
    // §5.3: featherPx = min(preset.featherPx, max(1, round(min(slotW, slotH) x 0.004))).
    // The cap is a ceiling on what the preset asks for, not a floor on the engine:
    // a 1000 px slot leaves bold's 2 alone, a 60 px slot pulls it to 1, and a preset
    // that says no feather gets none even in a slot large enough for 4 px.
    const uncapped = await refineEdges(await fringeCutout(), bold, { width: 1000, height: 1200 });
    expect(uncapped.applied.featherPx).toBe(2);
    const capped = await refineEdges(await fringeCutout(), bold, { width: 60, height: 80 });
    expect(capped.applied.featherPx).toBe(1);
    const none = await refineEdges(await fringeCutout(), off, { width: 1000, height: 1200 });
    expect(none.applied.featherPx).toBe(0);
    expect(await alphaAt(capped.png, 30, 30)).toBe(255);                    // interior stays hard
    expect(await alphaAt(none.png, 48, 30)).toBe(128);                      // matte byte-exact
  });
});
