/**
 * P2 Task 7 — face-safe layering (spec §8.2).
 *
 * A foreground overlay (laurels, badge, ribbon) must not sit *on* the face: the
 * cut is made in the overlay's alpha, over an elliptical radial falloff centred
 * on the derived face box, so the laurel still crosses hair and shoulders and
 * the only thing lost is opacity. Two shapes matter here: the falloff has to be
 * monotone away from the face centre (§8.2's "strongest at the centre of the
 * face box"), and the cut must not leave the placement rectangle, because an
 * overlay that dims the frame art beside the slot is a visible bug in a
 * compositor that was only asked to keep one face clear.
 *
 * The overlay is solid alpha 255 everywhere, so every reading below is the pass
 * and nothing else.
 */
import { describe, expect, it } from 'vitest';
import { protectFace } from '@/src/lib/rendering/blend/face-safe';
import { alphaAt, countAlpha, pixelAt, rawRgba, rgbaPng } from './fixtures';

const solid = () => rgbaPng(200, 200, () => ({ r: 255, g: 215, b: 0, a: 255 }));
const rect = { left: 50, top: 50, width: 100, height: 100 };
const face = { x: 100, y: 100, width: 25, height: 31 };   // centre (112.5, 115.5), half-axes 12.5 × 15.5

describe('protectFace', () => {
  it('thins the overlay over the face, most at its centre, and restores it outside the feathered band', async () => {
    const layer = await solid();
    const out = await protectFace(layer, { target: rect, face, strength: 0.92 });

    const centre = await alphaAt(out, 112, 115);       // ρ ≈ 0  -> 255·(1 − 0.92) ≈ 20
    const mid = await alphaAt(out, 112, 126);          // ρ ≈ 0.68 of the half-height
    const band = await alphaAt(out, 112, 132);         // ρ ≈ 1.07: inside the outer 20 %, almost restored
    expect(centre).toBeLessThan(30);
    expect(centre).toBeGreaterThan(0);                 // thinned, never deleted — the laurel still reads
    expect(mid).toBeGreaterThan(centre + 50);
    expect(band).toBeGreaterThan(200);
    expect(band).toBeLessThan(255);
    expect(await alphaAt(out, 112, 150)).toBe(255);    // ρ > 1.2: past the feather
    expect(await alphaAt(out, 60, 60)).toBe(255);      // inside the slot, away from the face
    expect(await alphaAt(out, 10, 10)).toBe(255);      // outside the slot

    const cut = await countAlpha(out, (a) => a < 255);
    expect(cut).toBeGreaterThan(300);                  // the falloff ellipse is ≈ 876 px wide
    expect(cut).toBeLessThan(1200);                    // and nothing else

    // A face box that straddles the slot edge must only cut inside the slot.
    const straddle = await protectFace(layer, { target: rect, face: { x: 30, y: 95, width: 40, height: 20 }, strength: 0.92 });
    expect(await alphaAt(straddle, 50, 105)).toBeLessThan(40);    // ρ ≈ 0.06 at the first column of the rect -> 255·(1 − 0.92·0.95) ≈ 31
    expect(await alphaAt(straddle, 49, 105)).toBe(255);           // one pixel left: the neighbouring frame art is intact

    // The cut is in alpha only; §8.2 forbids darkening the overlay itself.
    expect((await pixelAt(out, 112, 115)).rgb).toEqual([255, 215, 0]);
  });

  it('leaves the bytes alone when the face is outside the rectangle or protection is off', async () => {
    const layer = await solid();
    const again = await protectFace(layer, { target: rect, face: { x: 0, y: 0, width: 20, height: 20 }, strength: 0.92 });
    expect(again.equals(layer)).toBe(true);
    const off = await protectFace(layer, { target: rect, face, strength: 0 });
    expect(off.equals(layer)).toBe(true);
    const { alpha } = await rawRgba(off);
    expect(alpha(112, 115)).toBe(255);
  });
});
