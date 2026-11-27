/**
 * P2 Task 3 — reading the silhouette back out of the cutout's own alpha
 * (spec §8.1, §13).
 *
 * The four cases are the four ways a placement can be wrong, and all four are
 * decided by arithmetic rather than by taste:
 *
 * - the bbox must be the *subject*, not the canvas, or Mode A scales a
 *   half-empty frame up to fill a slot;
 * - the head and shoulder rows must separate, because both the placement anchor
 *   and the protected face box hang off where the shoulders start;
 * - a fully transparent cutout (a vendor that returned an empty matte) must
 * *answer* rather than throw, since a throw inside a claimed job is a red herring
 * for a data problem;
 * - a faint halo below the measurement threshold must not count, or Cloudinary's
 *   soft edge becomes "the subject" and every portrait shrinks.
 */
import { describe, expect, it } from 'vitest';
import { measureSubject } from '@/src/lib/rendering/blend/subject-metrics';
import { CLEAR, figurePng, rgbaPng, transparentPng } from './fixtures';

describe('measureSubject', () => {
  it('recovers the planted geometry', async () => {
    // head [40,90) 40 wide, body [90,260) 80 wide, canvas 200x300 centred on x=100
    const m = await measureSubject(await figurePng());
    expect(m.width).toBe(200);
    expect(m.height).toBe(300);
    expect(m.bbox).toEqual({ x: 60, y: 40, width: 80, height: 220 });
    expect(m.headTop).toBe(40);
    expect(m.headWidth).toBe(40);
    expect(m.shoulderY).toBe(90);                 // first row where width >= 1.8 * headWidth
    expect(m.headBottom).toBe(90);                // exclusive end of the head's own span
    expect(m.silhouetteHeight).toBe(220);         // == bbox.height
    expect(m.bottomY).toBe(259);
    expect(m.coverage).toBeGreaterThan(0.3);      // 80x170 + 40x50 inside an 80x220 box
  });

  it('keeps the face box inside the head and out of the shoulders', async () => {
    const m = await measureSubject(await figurePng());
    expect(m.face.y).toBeGreaterThanOrEqual(m.headTop);
    expect(m.face.y + m.face.height).toBeLessThanOrEqual(m.shoulderY ?? m.bbox.y + m.bbox.height);
    expect(m.face.x).toBeGreaterThanOrEqual(m.bbox.x);
    expect(m.face.width).toBeLessThanOrEqual(m.headWidth);      // protects a face, not a bust
  });

  it('returns an empty bbox rather than throwing on a fully transparent image', async () => {
    const m = await measureSubject(await transparentPng(64, 64));
    expect(m.bbox).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(m.shoulderY).toBeNull();
    expect(m.coverage).toBe(0);
  });

  it('ignores alpha below the measurement threshold when bounding the subject', async () => {
    // A faint 40x40 wash at alpha 6 (< ALPHA_TEST 8) around a planted 20x20 core
    // must not move the bbox — this is what keeps a vendor halo from becoming
    // "the subject" and shrinking the placement.
    const png = await rgbaPng(100, 100, (x, y) => {
      if (x >= 40 && x < 60 && y >= 40 && y < 60) return { r: 10, g: 10, b: 10, a: 255 };
      if (x >= 30 && x < 70 && y >= 30 && y < 70) return { r: 0, g: 0, b: 0, a: 6 };
      return CLEAR;
    });
    expect((await measureSubject(png)).bbox).toEqual({ x: 40, y: 40, width: 20, height: 20 });
  });
});
