/**
 * The blend orchestrator (spec §4, §6.4, §10).
 *
 * This is the only place the seven stages are seen together, so it is the place
 * that answers two questions the stage tests cannot: did they run in the order
 * the spec's data flow says, and did they agree on one geometry? Every fixture
 * therefore uses the same 1000 px template and the same 400×400 box at
 * (100, 100) that Tasks 4, 5 and 7 were written against — if the engine passes
 * while some stage quietly re-derived its own numbers, those tests would have
 * disagreed long ago.
 *
 * Pixels are not asserted here; each stage owns its own pixel proof. What is
 * asserted is the *record*, because `render_params.blend` is the deliverable
 * §6.4 asks for: an operator comparing two contestants' portraits has to be able
 * to read the numbers apart, and a job that silently did nothing has to say so
 * with a reason rather than a throw.
 */
import { describe, expect, it } from 'vitest';
import { blendSubject } from '@/src/lib/rendering/blend/index';
import { resolveBlendParams } from '@/src/lib/rendering/blend/params';
import { measureSubject } from '@/src/lib/rendering/blend/subject-metrics';
import type { SlotConfig } from '@/src/lib/rendering/imageCompositor';
import { figurePng, holedTemplate, opaqueTemplate, transparentPng } from './fixtures';

// A 1000 px template whose window is the same 400×400 box at (100,100) that
// Tasks 4, 5 and 7 place into, so a passing engine test means every stage
// agrees on one geometry rather than on three different ones.
const slot = (o: Partial<SlotConfig> = {}): SlotConfig => ({
  id: 's1', slot_name: 'contestant', slot_type: 'contestant', slot_order: 0,
  x: 100, y: 100, width: 400, height: 400, rotation: 0, z_index: 1, scale: 1,
  crop_mode: 'cover', border_radius: 0, opacity: 1, face_protect: true, ...o,
});
const canvas = { width: 1000, height: 1000 };
const hole = { x: 100, y: 100, width: 400, height: 400 };

const DECISION_KEYS = ['applied', 'edge', 'faceProtected', 'light', 'mode', 'placement', 'preset', 'shadow'];

describe('blendSubject', () => {
  it('runs measure -> mode -> place -> refine -> match -> shadow and reports all of it', async () => {
    const subjectPng = await figurePng();
    const out = await blendSubject({
      subjectPng, templatePng: await holedTemplate(1000, hole),
      canvas, slot: slot(), params: resolveBlendParams('natural'),
    });

    expect(Object.keys(out.decisions).sort()).toEqual(DECISION_KEYS);
    expect(out.decisions.preset).toBe('natural');
    expect(out.decisions.applied).toBe(true);
    // §13: the transparent window is a photo area, so the subject is a window shot.
    expect(out.decisions.mode).toEqual({ declared: 'auto', used: 'photo_area' });
    expect(out.placement?.mode).toBe('photo_area');
    expect(out.placement?.faceOnCanvas.y).toBeGreaterThan(0);
    // The window is the frame: its floor is canvas row 500, feet on it.
    expect(out.placement!.target.top + out.placement!.target.height).toBe(500);
    expect(out.faceSafe).toEqual({ face: out.placement!.faceOnCanvas, strength: 0.92 });
    expect(out.subjectPng).not.toBe(subjectPng);              // a re-encoded cutout came back
    expect(out.jpegQuality).toBe(90);                         // §9's quality travels with an applied render
    // §7: inside a clipping window the auto shadow pass declines — its ink would
    // land on the window's own art and read as a smudge.
    expect(out.underlays).toEqual([]);
    expect(out.decisions.shadow).toMatchObject({ layers: 0, mode: 'auto' });
  });

  it('grounds a figure on an opaque plate, and declines to when the slot rounds it off', async () => {
    const natural = resolveBlendParams('natural');
    const plate = await opaqueTemplate(1000);

    const out = await blendSubject({
      subjectPng: await figurePng(), templatePng: plate,
      canvas, slot: slot(), params: natural,
    });
    expect(out.decisions.mode).toEqual({ declared: 'auto', used: 'background' });
    expect(out.underlays).toHaveLength(2);                    // drop + contact for preset natural
    expect(out.decisions.shadow).toMatchObject({ layers: 2, mode: 'auto', clipped: false });
    // The dark plate is far below skin, so §6.3's gain floor is what binds here:
    // the wanted gain is about 0.22, and the most `natural` may apply is 0.92.
    const light = out.decisions.light as { gain: number; clamped: string[]; refLuma: number };
    expect(light.gain).toBe(0.92);
    expect(light.clamped).toContain('gain');
    expect(light.refLuma).toBeCloseTo(0.2126 * 20 + 0.7152 * 40 + 0.0722 * 80, 6);

    // A round window is the other half of §7's `auto` rule: the shadow is not
    // drawn under an overlay the compositor is about to cut to a circle.
    const round = await blendSubject({
      subjectPng: await figurePng(), templatePng: plate,
      canvas, slot: slot({ border_radius: 200 }), params: natural,
    });
    expect(round.underlays).toEqual([]);
    expect(round.decisions.shadow).toMatchObject({ layers: 0, clipped: true });

    const toldTo = await blendSubject({
      subjectPng: await figurePng(), templatePng: plate,
      canvas, slot: slot({ border_radius: 200 }), params: resolveBlendParams('natural', { shadow: 'on' }),
    });
    expect(toldTo.underlays).toHaveLength(2);                 // `on` overrides the decline
    expect(toldTo.decisions.shadow).toMatchObject({ layers: 2, mode: 'on', clipped: true });

    // §8.2's flag is the author's, and the engine is where it is read: an
    // overlay design meant to cross the face publishes no protected box, so the
    // compositor has nothing to cut.
    const uncaged = await blendSubject({
      subjectPng: await figurePng(), templatePng: plate,
      canvas, slot: slot({ face_protect: false }), params: natural,
    });
    expect(uncaged.faceSafe).toBeNull();
    expect(uncaged.decisions.faceProtected).toMatchObject({ on: false, strength: 0.92 });
  });

  it('publishes the preset\'s own protection strength, not a number the engine invents', async () => {
    const plate = await opaqueTemplate(1000);
    const studio = await blendSubject({
      subjectPng: await figurePng(), templatePng: plate,
      canvas, slot: slot(), params: resolveBlendParams('studio'),
    });
    expect(studio.faceSafe).toMatchObject({ strength: 0.85 });
    expect(studio.jpegQuality).toBe(90);

    const bold = await blendSubject({
      subjectPng: await figurePng(), templatePng: plate,
      canvas, slot: slot(), params: resolveBlendParams('bold'),
    });
    expect(bold.faceSafe).toMatchObject({ strength: 0.70 });  // §8.2: bold protects, never off
    expect(bold.jpegQuality).toBe(92);                        // §12's per-preset quality
    expect(bold.decisions.preset).toBe('bold');
  });

  it('reports a no-op for the "off" preset so the runner can use the legacy path', async () => {
    const subjectPng = await figurePng();
    const out = await blendSubject({
      subjectPng, templatePng: await holedTemplate(1000, hole),
      canvas, slot: slot(), params: resolveBlendParams('off'),
    });
    expect(out.subjectPng).toBe(subjectPng);                  // identity: same reference in, same out
    expect(out.decisions).toEqual({ preset: 'off', applied: false });
    expect(out.placement).toBeNull();                         // no geometry was decided, so none is reported
    expect(out.underlays).toEqual([]);
    expect(out.faceSafe).toBeNull();
    expect(out.jpegQuality).toBeNull();                       // §14.11: a declined blend encodes as P1 did
  });

  it('survives a fully transparent subject without inventing a placement', async () => {
    const subjectPng = await transparentPng(200, 300);
    const out = await blendSubject({
      subjectPng, templatePng: await holedTemplate(1000, hole),
      canvas, slot: slot(), params: resolveBlendParams('natural'),
    });
    expect(out.decisions).toMatchObject({ preset: 'natural', applied: false, reason: 'empty-subject' });
    expect(out.subjectPng).toBe(subjectPng);
    expect(out.placement).toBeNull();
    expect(out.faceSafe).toBeNull();
  });

  it('declines only the light stage when there is nothing around the slot to match', async () => {
    // Every pixel below 200 alpha is not a reference (§6.2), and a template with
    // no opaque neighbourhood is that case rather than a neutral one.
    const out = await blendSubject({
      subjectPng: await figurePng(), templatePng: await transparentPng(1000, 1000),
      canvas, slot: slot(), params: resolveBlendParams('natural'), photoMode: 'background',
    });
    expect(out.decisions.applied).toBe(true);                 // edges, placement and grounding still ran
    expect(out.decisions.light).toEqual({ applied: false, reason: 'no-reference-region' });
    expect(out.underlays).toHaveLength(2);
  });

  it('agrees with itself on the measurement and moves by the overrides it is given', async () => {
    const subjectPng = await figurePng();
    const templatePng = await opaqueTemplate(1000);
    const params = resolveBlendParams('studio');
    const shared = { subjectPng, templatePng, canvas, slot: slot(), params };

    const measured = await blendSubject(shared);
    // The runner measures the cutout to decide whether it is worth compositing at
    // all; handing the same metrics in must not change one number of the result.
    const supplied = await blendSubject({ ...shared, metrics: await measureSubject(subjectPng) });
    expect(supplied.decisions).toEqual(measured.decisions);

    const nudged = await blendSubject({ ...shared, overrides: { xOffset: 20, yOffset: -10 } });
    expect(nudged.placement!.target.left).toBe(measured.placement!.target.left + 20);
    expect(nudged.placement!.target.top).toBe(measured.placement!.target.top - 10);
    expect(nudged.placement!.target.width).toBe(measured.placement!.target.width);   // moved, not resized
    expect(nudged.decisions.placement).toMatchObject({ source: nudged.placement!.source });
  });

  it('degrades with the stage that failed rather than throwing at the runner', async () => {
    // §10: a blend defect must not cost a contestant their portrait. Undecodable
    // bytes are the failure every stage shares, and the answer has to name which
    // step met it while handing back the untouched cutout for P1's paste path.
    const out = await blendSubject({
      subjectPng: Buffer.from('not an image'), templatePng: await opaqueTemplate(1000),
      canvas, slot: slot(), params: resolveBlendParams('natural'),
    });
    expect(out.decisions).toMatchObject({ preset: 'natural', applied: false, stage: 'measure' });
    expect(typeof out.decisions.error).toBe('string');
    expect(out.subjectPng.toString()).toBe('not an image');  // the bytes the runner fell back with
    expect(out.placement).toBeNull();
    expect(out.jpegQuality).toBeNull();
  });
});
