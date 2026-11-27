/**
 * P2 Task 7 — grounding shadows (spec §7).
 *
 * The two layers are built from the subject's own silhouette and masked with
 * `1 − alphaSubject` *after* the blur, which is the order §7's last bullet
 * requires and the only order that makes its prohibitions structural: a shadow
 * that can only appear where the subject is not cannot read as an outline or a
 * glow, and a layer blurred before it is masked cannot bleed back into the
 * figure.
 *
 * The fixture is a 40 px disc in a 100 px subject and the placement is 1:1 at
 * (100, 100), so subject row `r` is canvas row `r + 100` and every number below
 * is readable off the disc: `hypot < 20` is false at exactly 20, so its matte
 * spans rows 31..69, its feet land on canvas 169, and §7's contact band
 * `[bboxBottom − contactHeight, bboxBottom + 2]` is rows 165..171.
 */
import { describe, expect, it } from 'vitest';
import { buildShadowLayers } from '@/src/lib/rendering/blend/shadow';
import { resolveBlendParams } from '@/src/lib/rendering/blend/params';
import { measureSubject } from '@/src/lib/rendering/blend/subject-metrics';
import { alphaAt, countAlpha, rgbaPng } from './fixtures';
import type { Placement } from '@/src/lib/rendering/blend/placement';

const disc = () => rgbaPng(100, 100, (x, y) => (Math.hypot(x - 50, y - 50) < 20
  ? { r: 200, g: 160, b: 130, a: 255 }
  : { r: 0, g: 0, b: 0, a: 0 }));

const placement: Placement = {
  source: { x: 0, y: 0, width: 100, height: 100 },
  target: { left: 100, top: 100, width: 100, height: 100 },
  faceOnCanvas: { x: 130, y: 115, width: 25, height: 31 },
  anchor: 'centre', mode: 'background', scale: 1,
};

const natural = resolveBlendParams('natural');   // drop .10 / blur 12 / offset 10 / contact .12
const PAD = Math.ceil(2 * 12);                   // shadowBlurPx 12 -> pad 24, so the blur is never clipped

describe('buildShadowLayers', () => {
  it('draws nothing where the subject is, so it cannot read as an outline or a glow', async () => {
    const subject = await disc();
    const m = await measureSubject(subject);
    expect(m.bottomY).toBe(69);                    // the row every band calculation hangs on
    const layers = await buildShadowLayers(subject, placement, m, natural);
    expect(layers).toHaveLength(2);
    for (const l of layers) {
      expect(await alphaAt(l.buffer, 150 - l.left, 150 - l.top)).toBe(0);   // disc core
      expect(await alphaAt(l.buffer, 140 - l.left, 140 - l.top)).toBe(0);   // and nearer its edge
      expect(await alphaAt(l.buffer, 150 - l.left, 166 - l.top)).toBe(0);   // inside the figure, inside the band
    }
  });

  it('grounds the figure: a drop layer below it and a contact layer at its feet', async () => {
    const subject = await disc();
    const m = await measureSubject(subject);
    const [drop, contact] = await buildShadowLayers(subject, placement, m, natural);

    expect(await countAlpha(drop.buffer, (a) => a > 0)).toBeGreaterThan(200);
    expect(drop.left).toBe(100 - PAD);
    expect(drop.top).toBe(100 - PAD + 10);                                  // §12 shadowOffsetPx, downward
    expect(await alphaAt(drop.buffer, 150 - drop.left, 176 - drop.top)).toBeGreaterThan(0);
    expect(await countAlpha(drop.buffer, (a) => a > Math.round(0.10 * 255) + 1)).toBe(0);  // never above dropOpacity

    expect(contact.top).toBe(100 - PAD);              // §7: the contact shadow hugs the feet, it is not the cast shadow
    expect(await countAlpha(contact.buffer, (a) => a > 0)).toBeGreaterThan(50);
    expect(await countAlpha(contact.buffer, (a) => a > Math.round(0.12 * 255) + 1)).toBe(0);
    expect(await alphaAt(contact.buffer, 150 - contact.left, 170 - contact.top)).toBeGreaterThan(0);
    expect(await alphaAt(contact.buffer, 150 - contact.left, 171 - contact.top)).toBeGreaterThan(0);
    expect(await alphaAt(contact.buffer, 150 - contact.left, 130 - contact.top)).toBe(0);  // nowhere above the feet
  });

  it('is absent for a clipped window under `auto`, for the off preset, and when told to skip the pass', async () => {
    const subject = await disc();
    const m = await measureSubject(subject);
    const clipped = { ...placement, clip: { left: 100, top: 100, width: 100, height: 100 } };
    // §7: `auto` means off when the slot clips — a shadow inside a round window
    // lands on the window's own art and reads as a smudge. `on` overrides that.
    expect(await buildShadowLayers(subject, clipped, m, natural)).toEqual([]);
    expect(await buildShadowLayers(subject, clipped, m, resolveBlendParams('natural', { shadow: 'on' }))).toHaveLength(2);
    expect(await buildShadowLayers(subject, placement, m, resolveBlendParams('off'))).toEqual([]);
    expect(await buildShadowLayers(subject, placement, m, resolveBlendParams('natural', { dropOpacity: 0, contactOpacity: 0 }))).toEqual([]);
  });

  it('reads §7\'s rounding trigger from the slot, not only from the placement', async () => {
    const subject = await disc();
    const m = await measureSubject(subject);
    // `border_radius > 0` is what §7's parenthetical names, and the compositor
    // cuts that circle itself — so the engine, which knows the slot, has to be
    // able to say "this render clips" about a Mode A placement that has no
    // window of its own. Without the fifth argument the shadow would be drawn
    // and then round-clipped away, leaving a quarter-cut smudge at each corner.
    expect(await buildShadowLayers(subject, placement, m, natural, true)).toEqual([]);
    expect(await buildShadowLayers(subject, placement, m, natural, false)).toHaveLength(2);
    expect(await buildShadowLayers(subject, placement, m, resolveBlendParams('natural', { shadow: 'on' }), true)).toHaveLength(2);
  });
});
