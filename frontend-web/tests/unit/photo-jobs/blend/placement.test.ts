/**
 * P2 Task 4 — placement and mode (spec §5, §13).
 *
 * Every expectation is a number derived from `figurePng`'s planted geometry
 * (head 40x50 at y 40, body 80 wide to y 260, subject canvas 200x300), so a
 * failure points at the arithmetic rather than at a fixture nobody can read.
 *
 * The rules under test are the three the spec says make a gallery look
 * consistent, plus the two that keep a template usable:
 *
 * - Mode A keeps the subject's aspect ratio and stands its feet on the slot
 *   floor, and the scale is head-normalised then box-capped — §13.2's silhouette
 *   fill alone would make a tight crop and a loose one disagree about head size,
 *   which is §13.5's entire complaint;
 * - Mode B covers the window, crops from the subject, and clips at the window —
 *   never at the bleed box, or the bleed escapes the frame;
 * - a `wide` silhouette is capped by width, not by height, because a subject cut
 *   at the shoulders is the failure an admin sees first.
 */
import { describe, expect, it } from 'vitest';
import type { SlotConfig } from '@/src/lib/rendering/imageCompositor';
import { BLEED_PAD, CANONICAL_HEAD_SHARE, planPlacement, resolvePhotoMode } from '@/src/lib/rendering/blend/placement';
import { resolveBlendParams } from '@/src/lib/rendering/blend/params';
import { measureSubject } from '@/src/lib/rendering/blend/subject-metrics';
import { figurePng, holedTemplate, opaqueTemplate } from './fixtures';

const natural = resolveBlendParams('natural');   // subjectFill 0.94
const CANVAS = { width: 1000, height: 1000 };
const slot = (o: Partial<SlotConfig> = {}): SlotConfig => ({
  id: 's1', slot_name: 'contestant', slot_type: 'contestant', slot_order: 0,
  x: 100, y: 100, width: 400, height: 400, rotation: 0, z_index: 1, scale: 1,
  crop_mode: 'cover', border_radius: 0, opacity: 1, ...o,
});
const of = async (o: Parameters<typeof figurePng>[0] = {}) => measureSubject(await figurePng(o));

describe('planPlacement', () => {
  it('Mode A preserves the subject aspect and puts the feet on the slot bottom', async () => {
    const p = planPlacement({ mode: 'background', slot: slot(), metrics: await of(), params: natural, canvas: CANVAS });
    // fill cap = 400 * 0.94 = 376 over a 220px silhouette -> scale 1.7091
    expect(p.target.height).toBe(376);
    expect(p.target.width).toBe(Math.round(80 * (376 / 220)));
    expect(p.anchor).toBe('bottom');                       // silhouette reaches its bottom third
    expect(p.target.top + p.target.height).toBe(500);      // slot bottom = the shared ground line
    expect(p.source).toEqual({ x: 60, y: 40, width: 80, height: 220 });  // nothing cropped
    expect(p.scale).toBeCloseTo(376 / 220, 6);
  });

  it('caps by width so a wide silhouette is never cut', async () => {
    // A 900px-wide seated figure: head 100x100 at y 100, body to y 900.
    const m = await of({ w: 1000, h: 1000, headTop: 100, headWidth: 100, headHeight: 100, bodyWidth: 900, bodyBottom: 900 });
    expect(m.bbox).toEqual({ x: 50, y: 100, width: 900, height: 800 });
    const p = planPlacement({ mode: 'background', slot: slot(), metrics: m, params: natural, canvas: CANVAS });
    // 400/900 = 0.4444 is below both the fill cap (376/800) and the head cap
    // (112.8/100), so width is the binding one and the figure fits exactly.
    expect(p.target.width).toBe(400);
    expect(p.target.height).toBe(356);
    expect(p.target.height).toBeLessThan(376);             // width became the binding cap
  });

  it('normalises framing: the head, not the crop, sets the scale (§13.5)', async () => {
    const tight = planPlacement({ mode: 'background', slot: slot(), canvas: CANVAS, params: natural,
      metrics: await of({ h: 300, headTop: 20, headWidth: 40, headHeight: 50, bodyWidth: 120, bodyBottom: 120 }) });
    const loose = planPlacement({ mode: 'background', slot: slot(), canvas: CANVAS, params: natural,
      metrics: await of({ h: 300, headTop: 20, headWidth: 40, headHeight: 50, bodyWidth: 120, bodyBottom: 170 }) });
    // Same 50px head in both, different silhouette extent (100 vs 150) and both fit.
    expect(tight.target.height).toBeCloseTo(100 * (112.8 / 50), 0);
    expect(loose.target.height).toBeCloseTo(150 * (112.8 / 50), 0);
    expect(tight.scale).toBeCloseTo(loose.scale, 6);       // one head size -> one scale
  });

  it('Mode B fills the window, keeps the head inside it and clips the overflow', async () => {
    const p = planPlacement({ mode: 'photo_area', slot: slot(), metrics: await of(), params: natural, canvas: CANVAS });
    expect(p.target).toEqual({ left: 100, top: 100, width: 400, height: 400 });  // the window
    expect(p.clip).toEqual({ left: 100, top: 100, width: 400, height: 400 });
    // cover of an 80x220 silhouette by a 400x400 window -> scale 5 -> the window
    // shows 80 subject px wide and 80 tall, so the rest of the body is clipped.
    expect(p.source.width).toBe(80);
    expect(p.source.height).toBe(80);
    expect(p.source.y).toBeLessThanOrEqual(40);            // headTop still inside, §13.3
    expect(p.faceOnCanvas.y).toBeGreaterThanOrEqual(124 - 6);   // headroom 0.06 * h
    expect(p.faceOnCanvas.y + p.faceOnCanvas.height).toBeLessThanOrEqual(500);
  });

  it('bleed enlarges the placement box and leaves the clip as the window', async () => {
    const p = planPlacement({ mode: 'photo_area', slot: slot({ bleed: true }), metrics: await of(), params: natural, canvas: CANVAS });
    expect(p.clip).toEqual({ left: 100, top: 100, width: 400, height: 400 });
    expect(p.target).toEqual({ left: 70, top: 70, width: 460, height: 460 });    // 15 % centred pad
    expect(p.source.width).toBe(Math.round(460 / 5.75));   // cover now resolves against the bleed box
    expect(BLEED_PAD).toBe(0.15);
    expect(CANONICAL_HEAD_SHARE).toBe(0.30);
  });

  it('applies editor offsets last and on top of the plan', async () => {
    const m = await of();
    const args = { mode: 'background' as const, slot: slot(), metrics: m, params: natural, canvas: CANVAS };
    const base = planPlacement(args);
    const moved = planPlacement({ ...args, overrides: { yOffset: -20, xOffset: 5 } });
    expect(moved.target.top).toBe(base.target.top - 20);
    expect(moved.target.left).toBe(base.target.left + 5);
    expect(moved.target.height).toBe(base.target.height);   // a nudge is not a resize
    const bigger = planPlacement({ ...args, overrides: { scale: 1.1 } });
    expect(bigger.target.height).toBe(Math.round(base.target.height * 1.1));
    expect(bigger.scale).toBeCloseTo(base.scale * 1.1, 6);
  });

  it('reads the template when the mode is auto and obeys it when declared', async () => {
    expect(await resolvePhotoMode(await opaqueTemplate(400), slot(), 'auto')).toBe('background');
    // The slot runs past the 400px canvas; the probe is clamped, not fatal.
    expect(await resolvePhotoMode(await holedTemplate(400, { x: 100, y: 100, width: 400, height: 400 }), slot(), 'auto')).toBe('photo_area');
    expect(await resolvePhotoMode(await opaqueTemplate(400), slot(), 'photo_area')).toBe('photo_area');
    expect(await resolvePhotoMode(await opaqueTemplate(400), slot(), 'nonsense')).toBe('background'); // falls back, never throws
  });
});
