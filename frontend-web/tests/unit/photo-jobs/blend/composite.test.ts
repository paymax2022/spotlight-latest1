/**
 * P3 Task 5 — the one blended-composite path the job runner and the studio
 * preview share (spec §5, §10, §14.11).
 *
 * The point of extracting this from `runner.ts` is not tidiness. The preview
 * route needs exactly the pixels the queue will produce, and two implementations
 * of "blend then composite" is how a studio that previews one thing and publishes
 * another gets built. So these tests are written against the seam:
 *
 * - the compositor must be handed the *bytes* and never a URL, because §14.11's
 *   "the read is paid for" only holds if nothing downstream re-fetches;
 * - `off` must be byte-identical to the P1-shaped call, which is what lets an
 *   operator select a code path rather than hope arithmetic cancels out;
 * - and a real blend must actually change the pixels, or the extraction is a
 *   rename.
 *
 * The last two cases are about §10's degrade, which moved here with the rest of
 * the blend decision: an engine that throws renders the caller's fallback and
 * says why, and a caller that passes no fallback still sees the throw.
 *
 * `compositeImage` is spied on through the real implementation rather than
 * replaced, so the assertions about the recorded input are assertions about a
 * render that also produced the bytes checked below.
 */
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { blendSubject as blendSubjectReal } from '@/src/lib/rendering/blend';
import { compositeImage as compositeImageReal, type CompositorInput } from '@/src/lib/rendering/imageCompositor';
import { compositeWithBlend } from '@/src/lib/rendering/blend/composite';
import { resolveBlendParams } from '@/src/lib/rendering/blend/params';
import { figurePng, opaqueTemplate } from './fixtures';
import type { SlotConfig } from '@/src/lib/rendering/imageCompositor';

vi.mock('@/src/lib/rendering/imageCompositor', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/lib/rendering/imageCompositor')>();
  return { ...real, compositeImage: vi.fn(real.compositeImage) };
});
vi.mock('@/src/lib/rendering/blend', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/lib/rendering/blend')>();
  return { ...real, blendSubject: vi.fn(real.blendSubject) };
});

const compositeImage = vi.mocked(compositeImageReal);
const blendSubject = vi.mocked(blendSubjectReal);

const slot = {
  id: 's1', slot_name: 'contestant', slot_type: 'contestant', slot_order: 0,
  x: 140, y: 160, width: 160, height: 220, rotation: 0, z_index: 1, scale: 1,
  crop_mode: 'cover', border_radius: 0, opacity: 1,
  anchor: 'bottom', bleed: false, face_protect: true,
} satisfies SlotConfig;

const CANVAS = { width: 400, height: 400 };

const args = async (over: { slot?: SlotConfig; preset?: string; settings?: unknown } = {}) => ({
  templatePng: await opaqueTemplate(CANVAS.width),
  canvas: CANVAS,
  slot: over.slot ?? slot,
  subjectPng: await figurePng({ w: 200, h: 300, headTop: 24, headWidth: 52, headHeight: 64, bodyWidth: 110, bodyBottom: 275 }),
  params: resolveBlendParams(over.preset ?? 'natural', over.settings),
  photoMode: 'auto',
  overrides: {},
});

describe('compositeWithBlend', () => {
  it('blends, composites, and hands back the decisions with the pixels', async () => {
    const r = await compositeWithBlend(await args());

    expect(r.decisions.applied).toBe(true);
    expect(r.mimeType).toBe('image/jpeg');       // §9: natural has a quality to pass
    const md = await sharp(r.buffer).metadata();
    expect(md).toMatchObject({ width: 400, height: 400 });
  });

  it('passes the bytes it was given, never a URL, plus the engine\'s geometry', async () => {
    const a = await args();
    compositeImage.mockClear();
    const r = await compositeWithBlend(a);

    expect(r.decisions.applied).toBe(true);

    const input = compositeImage.mock.calls.at(-1)![0];
    expect(input.templateUrl).toBeUndefined();
    expect(input.templateBytes).toBe(a.templatePng);
    expect(input.templateWidth).toBe(400);
    expect(input.templateHeight).toBe(400);
    expect(input.jpegQuality).toBe(r.decisions.jpegQuality ?? 90);
    expect(input.underlays?.length).toBeGreaterThan(0);   // §7's shadow layers
    expect(input.faceSafe).not.toBeNull();                // §8.2, slot says face_protect
    expect(input.slots[0].placement).not.toBeNull();      // §13's decided geometry
    // What gets drawn is the engine's refined matte, never the caller's buffer:
    // §6.3's edge pass and §6.2's light match happen before this array is built.
    const drawn = input.slots[0].photo_bytes;
    expect(drawn).toBeInstanceOf(Buffer);
    expect(drawn).not.toBe(a.subjectPng);
    expect(await sharp(drawn!).metadata()).toMatchObject({ format: 'png' });
  });

  it('leaves the face unprotected when the slot says so', async () => {
    const r = await compositeWithBlend(await args({ slot: { ...slot, face_protect: false } }));
    expect(r.decisions.applied).toBe(true);
    expect((r.decisions.faceProtected as { on: boolean }).on).toBe(false);

    const input = compositeImage.mock.calls.at(-1)![0];
    expect(input.faceSafe).toBeNull();
  });

  it('changes the pixels the unblended render would have produced', async () => {
    const a = await args();
    const direct = await compositeImage({
      templateBytes: a.templatePng,
      templateWidth: CANVAS.width,
      templateHeight: CANVAS.height,
      slots: [{ ...a.slot, photo_bytes: a.subjectPng }],
    });
    const blended = await compositeWithBlend(a);

    expect(blended.buffer.equals(direct.buffer)).toBe(false);
    expect(blended.buffer.byteLength).not.toBe(direct.buffer.byteLength);
  });

  it('answers `off` with exactly the P1-shaped render and applied:false', async () => {
    const a = await args({ preset: 'off' });
    compositeImage.mockClear();
    const off = await compositeWithBlend(a);

    expect(off.decisions).toMatchObject({ applied: false, preset: 'off' });
    const input = compositeImage.mock.calls.at(-1)![0];
    expect(input.jpegQuality).toBeUndefined();
    expect(input.underlays).toBeUndefined();
    expect(input.faceSafe).toBeUndefined();
    expect(input.slots[0].placement).toBeUndefined();

    // Byte identity against the call P1 made, which is §14.11's promise written as
    // an assertion instead of as an argument about arithmetic.
    const p1 = await compositeImage({
      templateBytes: a.templatePng,
      templateWidth: CANVAS.width,
      templateHeight: CANVAS.height,
      slots: [{ ...a.slot, photo_bytes: a.subjectPng }],
    });
    expect(off.buffer.equals(p1.buffer)).toBe(true);
  });

  it('appends the template\'s own foreground art after the subject', async () => {
    const badge = { ...slot, id: 'art1', slot_name: 'badge', slot_type: 'badge', z_index: 5, image_url: 'https://res.cloudinary.com/demo/badge.png' };
    const r = await compositeWithBlend({ ...(await args()), foregroundSlots: [badge] });

    expect(r.decisions.applied).toBe(true);
    const input = compositeImage.mock.calls.at(-1)![0];
    expect(input.slots).toHaveLength(2);
    expect(input.slots[1].id).toBe('art1');
    expect(input.slots[1].photo_bytes).toBeUndefined();  // art is drawn from its own URL
  });

  it('draws the caller\'s fallback when the engine throws, and records the reason', async () => {
    // §10: "a failed blend costs the blend and not the portrait." Living here
    // rather than in `runner.ts` is what makes the promise true for the preview
    // too, instead of leaving the studio as the surface where a throw becomes a
    // 500 and the queue the only one that degrades.
    const a = await args();
    const fallback: CompositorInput = {
      templateBytes: a.templatePng,
      templateWidth: CANVAS.width,
      templateHeight: CANVAS.height,
      slots: [{ ...a.slot, photo_bytes: a.subjectPng }],
    };
    blendSubject.mockRejectedValueOnce(new Error('median exploded'));
    compositeImage.mockClear();

    const r = await compositeWithBlend({ ...a, fallback });

    expect(r.decisions).toEqual({ applied: false, preset: 'natural', error: 'median exploded' });
    expect(compositeImage).toHaveBeenCalledTimes(1);            // the fallback, not a retry
    expect(compositeImage.mock.calls[0][0]).toBe(fallback);     // handed through untouched
    expect(r.mimeType).toBe('image/png');                       // and it encodes like P1: no quality reached the encoder
  });

  it('lets the throw through when the caller has no fallback to offer', async () => {
    const a = await args();
    blendSubject.mockRejectedValueOnce(new Error('median exploded'));
    await expect(compositeWithBlend(a)).rejects.toThrow('median exploded');
  });
});
