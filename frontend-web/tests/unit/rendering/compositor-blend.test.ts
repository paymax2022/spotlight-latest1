/**
 * P2 Task 8 — the compositor's blend-shaped inputs (spec §8, §9, §14.10).
 *
 * Five additions, and one rule that governs all of them: a caller that passes
 * none of them gets *today's* render. That rule is what makes §14.11's
 * "`blend_preset: 'off'` renders identically to main" provable, so the first
 * test below is the one that has to stay true no matter what else changes.
 *
 * The other four are the plumbing the blend orchestrator needs and that no
 * amount of engine-side math can supply itself: the runner has already paid for
 * the template and cutout bytes (and re-fetching a signed URL inside a claimed
 * job can fail on expiry), placement is a crop-then-resize the compositor is
 * the only party that can execute, shadows are underlays that must sit between
 * the template and the first slot, and the face-safe cut has to happen to a
 * rendered overlay — after its own transforms, before it is pasted.
 *
 * The encode test asserts §14.10's *rule* rather than a predicted winner: it
 * encodes both itself and checks the returned buffer is the smaller, because a
 * test that hard-codes "jpeg wins here" is a second source of truth that fails
 * on the next libvips upgrade.
 */
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { chooseEncode, compositeImage } from '@/src/lib/rendering/imageCompositor';
import { alphaAt, flatPng, holedTemplate, opaqueTemplate, pixelAt, rgbaPng } from '../photo-jobs/blend/fixtures';
import type { SlotConfig } from '@/src/lib/rendering/imageCompositor';
import type { Placement } from '@/src/lib/rendering/blend/placement';

const baseSlot = {
  id: 's1', slot_name: 'c', slot_type: 'contestant', slot_order: 0,
  x: 100, y: 100, width: 200, height: 200, rotation: 0, z_index: 1, scale: 1,
  crop_mode: 'cover', border_radius: 0, opacity: 1,
} satisfies SlotConfig;

/** An allowed-host URL would be fetched; this one cannot be, so a fetch is a visible failure. */
const UNFETCHABLE = 'https://redcdn.example/t.png';

const placed = (over: Partial<Placement> = {}): Placement => ({
  source: { x: 0, y: 0, width: 200, height: 200 },
  target: { left: 100, top: 100, width: 200, height: 200 },
  faceOnCanvas: { x: 150, y: 150, width: 60, height: 60 },
  anchor: 'centre', mode: 'background', scale: 1, ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe('compositeImage', () => {
  it('is a straight-line read when no caller passes the new fields', async () => {
    const template = await opaqueTemplate(400);
    // Quadrants again, so a resize that changed the aspect would change what is where.
    const photo = await rgbaPng(200, 200, (x, y) => ({ r: x < 100 ? 0 : 255, g: y < 100 ? 0 : 255, b: 0, a: 255 }));
    const fetched: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = String(input);
      fetched.push(url);
      return new Response(new Uint8Array(url.endsWith('p.png') ? photo : template));
    });

    const r = await compositeImage({
      templateUrl: 'https://res.cloudinary.com/demo/image/upload/t.png',
      templateWidth: 400, templateHeight: 400,
      slots: [{ ...baseSlot, x: 50, y: 50, width: 100, height: 100,
        photo_url: 'https://res.cloudinary.com/demo/image/upload/p.png' }],
    });

    expect(fetched).toEqual([
      'https://res.cloudinary.com/demo/image/upload/t.png',
      'https://res.cloudinary.com/demo/image/upload/p.png',
    ]);                                        // URLs still fetched when no bytes arrive
    const md = await sharp(r.buffer).metadata();
    expect(md).toMatchObject({ width: 400, height: 400, format: 'png' });
    expect(r.mimeType).toBe('image/png');       // quality absent -> PNG, exactly as today
    expect((await pixelAt(r.buffer, 60, 60)).rgb).toEqual([0, 0, 0]);      // slot's top-left quadrant
    expect((await pixelAt(r.buffer, 140, 140)).rgb).toEqual([255, 255, 0]); // its bottom-right
    expect((await pixelAt(r.buffer, 300, 300)).rgb).toEqual([20, 40, 80]);   // and no new geometry anywhere else
  });

  it('takes the caller\'s bytes instead of fetching the URL a second time', async () => {
    const r = await compositeImage({
      templateUrl: UNFETCHABLE, templateBytes: await opaqueTemplate(400),
      templateWidth: 400, templateHeight: 400,
      slots: [{ ...baseSlot, photo_url: UNFETCHABLE, photo_bytes: await flatPng(200, 200, { r: 255, g: 0, b: 0, a: 255 }) }],
    });
    expect((await pixelAt(r.buffer, 150, 150)).rgb).toEqual([255, 0, 0]);   // the slot drew
    expect((await pixelAt(r.buffer, 10, 10)).rgb).toEqual([20, 40, 80]);    // the template drew
    expect((await sharp(r.buffer).metadata()).format).toBe('png');
  });

  it('crops from source space and then resizes to the target box', async () => {
    // Quadrants: top-left black, top-right green, bottom-left red, bottom-right yellow.
    const subject = await rgbaPng(100, 100, (x, y) => ({ r: x < 50 ? 0 : 255, g: y < 50 ? 0 : 255, b: 0, a: 255 }));
    const r = await compositeImage({
      templateUrl: UNFETCHABLE, templateBytes: await opaqueTemplate(400), templateWidth: 400, templateHeight: 400,
      slots: [{ ...baseSlot, photo_bytes: subject,
        placement: placed({ source: { x: 50, y: 50, width: 50, height: 50 }, scale: 4 }) }],
    });
    expect((await pixelAt(r.buffer, 105, 105)).rgb).toEqual([255, 255, 0]);   // the bottom-right quadrant, and only it
    expect((await pixelAt(r.buffer, 295, 295)).rgb).toEqual([255, 255, 0]);
    expect((await pixelAt(r.buffer, 50, 50)).rgb).toEqual([20, 40, 80]);      // outside the target box
  });

  it('clips to the window a placement provides, and never past it', async () => {
    const big = await flatPng(600, 600, { r: 255, g: 255, b: 255, a: 255 });
    const r = await compositeImage({
      templateUrl: UNFETCHABLE, templateBytes: await opaqueTemplate(1000), templateWidth: 1000, templateHeight: 1000,
      slots: [{ ...baseSlot, photo_bytes: big,
        placement: placed({ source: { x: 0, y: 0, width: 600, height: 600 },
          target: { left: -100, top: -100, width: 800, height: 800 },
          clip: { left: 100, top: 100, width: 200, height: 200 }, mode: 'photo_area' }) }],
    });
    expect((await pixelAt(r.buffer, 150, 150)).rgb).toEqual([255, 255, 255]);   // inside the window
    expect((await pixelAt(r.buffer, 299, 299)).rgb).toEqual([255, 255, 255]);   // its last pixel
    expect((await pixelAt(r.buffer, 50, 50)).rgb).toEqual([20, 40, 80]);        // outside: the template
    expect((await pixelAt(r.buffer, 300, 300)).rgb).toEqual([20, 40, 80]);      // and one past the bleed
  });

  it('survives a placement whose source rect reaches past the subject image', async () => {
    // §10 reserves throws for the runner: an absurd window must scale the
    // subject a little rather than fail a claimed job.
    const subject = await rgbaPng(100, 100, (x, y) => ({ r: x < 50 ? 0 : 255, g: y < 50 ? 0 : 255, b: 0, a: 255 }));
    const r = await compositeImage({
      templateUrl: UNFETCHABLE, templateBytes: await opaqueTemplate(400), templateWidth: 400, templateHeight: 400,
      slots: [{ ...baseSlot, photo_bytes: subject,
        placement: placed({ source: { x: 80, y: 80, width: 100, height: 100 } }) }],
    });
    expect((await pixelAt(r.buffer, 105, 105)).rgb).toEqual([255, 255, 0]);
  });

  it('draws underlays below every slot', async () => {
    const r = await compositeImage({
      templateUrl: UNFETCHABLE, templateBytes: await opaqueTemplate(400), templateWidth: 400, templateHeight: 400,
      underlays: [{ buffer: await flatPng(20, 20, { r: 0, g: 0, b: 0, a: 255 }), left: 10, top: 10 }],
      slots: [{ ...baseSlot, photo_bytes: await flatPng(200, 200, { r: 9, g: 9, b: 9, a: 0 }) }],
    });
    expect((await pixelAt(r.buffer, 12, 12)).rgb).toEqual([0, 0, 0]);    // the underlay is not under nothing
    expect((await pixelAt(r.buffer, 110, 110)).rgb).toEqual([20, 40, 80]);  // and a fully transparent slot paints no box
  });

  it('protects the face on a foreground slot, and on nothing else', async () => {
    const face = { x: 150, y: 150, width: 60, height: 60 };
    const subjectBytes = await flatPng(200, 200, { r: 255, g: 0, b: 0, a: 255 });
    const badgeBytes = await flatPng(200, 200, { r: 0, g: 255, b: 0, a: 255 });
    const shared = { templateUrl: UNFETCHABLE, templateBytes: await opaqueTemplate(400), templateWidth: 400, templateHeight: 400 };

    const protected_ = await compositeImage({ ...shared, faceSafe: { face, strength: 0.92 },
      slots: [
        { ...baseSlot, photo_bytes: subjectBytes, placement: placed() },
        { ...baseSlot, id: 's2', slot_type: 'badge', z_index: 5, face_protect: true, photo_bytes: badgeBytes },
      ] });
    const over = (await pixelAt(protected_.buffer, 180, 180)).rgb;      // the face centre: 255·(1 − 0.92·0.986) ≈ 24 of badge
    expect(over[0]).toBeGreaterThan(200);
    expect(over[1]).toBeLessThan(60);
    expect((await pixelAt(protected_.buffer, 110, 110)).rgb).toEqual([0, 255, 0]);   // elsewhere it is a badge

    const unprotected = await compositeImage({ ...shared, faceSafe: { face, strength: 0.92 },
      slots: [
        { ...baseSlot, photo_bytes: subjectBytes, placement: placed() },
        { ...baseSlot, id: 's2', slot_type: 'badge', z_index: 5, face_protect: false, photo_bytes: badgeBytes },
      ] });
    expect((await pixelAt(unprotected.buffer, 180, 180)).rgb).toEqual([0, 255, 0]);  // §8.2's flag is honoured

    const subject = await compositeImage({ ...shared, faceSafe: { face, strength: 0.92 },
      slots: [{ ...baseSlot, photo_bytes: subjectBytes, placement: placed() }] });
    expect((await pixelAt(subject.buffer, 180, 180)).rgb).toEqual([255, 0, 0]);      // the subject is never cut

    // …and it is still never cut when its row arrives the way the column
    // default delivers it: `face_protect` is NOT NULL DEFAULT true on
    // template_slots, so the contestant slot carries the flag too. The slot
    // that carries a placement *is* the contestant, so its own face is the
    // thing being protected and thinning it would punch a hole in a face.
    const flagged = await compositeImage({ ...shared, faceSafe: { face, strength: 0.92 },
      slots: [{ ...baseSlot, face_protect: true, photo_bytes: subjectBytes, placement: placed() }] });
    expect((await pixelAt(flagged.buffer, 180, 180)).rgb).toEqual([255, 0, 0]);
  });

  it('draws a foreground slot whose only source is the template author\'s own art', async () => {
    // §8.1: `image_url` is the column that holds a decorative overlay, and the
    // runner passes the resolver's rows through as they come back, so the
    // renderer has to know that a slot can carry its own picture. Without this
    // the column is storage nothing reads.
    const badgeBytes = await flatPng(200, 200, { r: 0, g: 255, b: 0, a: 255 });
    const fetched: string[] = [];
    vi.stubGlobal('fetch', async (input: string | URL) => {
      fetched.push(String(input));
      return new Response(new Uint8Array(badgeBytes));
    });

    const r = await compositeImage({
      templateUrl: UNFETCHABLE, templateBytes: await opaqueTemplate(400), templateWidth: 400, templateHeight: 400,
      faceSafe: { face: { x: 150, y: 150, width: 60, height: 60 }, strength: 0.92 },
      slots: [
        { ...baseSlot, photo_bytes: await flatPng(200, 200, { r: 255, g: 0, b: 0, a: 255 }) },
        { ...baseSlot, id: 's2', slot_type: 'badge', z_index: 5, face_protect: true,
          image_url: 'https://res.cloudinary.com/demo/image/upload/banner.png' },
      ],
    });
    // One fetch, and it is the art's: the template came as bytes and the subject
    // slot has no source at all, so anything else here is a redundant read.
    expect(fetched).toEqual(['https://res.cloudinary.com/demo/image/upload/banner.png']);
    expect((await pixelAt(r.buffer, 110, 110)).rgb).toEqual([0, 255, 0]);            // the ribbon drew
    const over = (await pixelAt(r.buffer, 180, 180)).rgb;                             // over the face
    expect(over[0]).toBeGreaterThan(200);
    expect(over[1]).toBeLessThan(60);
  });

  it('encodes per §9: the smaller buffer, PNG on a tie, PNG whenever anything is transparent', async () => {
    const sizes = async (image: Buffer, quality: number) => ({
      png: (await sharp(image).png().toBuffer()).byteLength,
      jpeg: (await sharp(image).jpeg({ quality }).toBuffer()).byteLength,
    });

    // §14.10's named case: noise at this size is the one input q90 cannot lose to a deflate.
    const noisy = await rgbaPng(900, 1100, (x, y) => ({ r: (x * 7 + y * 13) % 256, g: (x * 11 + y * 3) % 256, b: (x * 5 + y * 17) % 256, a: 255 }));
    const photo = await chooseEncode(noisy, 90);
    expect(photo.mimeType).toBe('image/jpeg');
    expect(photo.buffer.byteLength).toBe(Math.min(...Object.values(await sizes(noisy, 90))));

    // The flat template: the rule decides, and the rule prefers PNG on a tie.
    const flat = await opaqueTemplate(200);
    const both = await sizes(flat, 90);
    const picked = await chooseEncode(flat, 90);
    expect(picked.mimeType).toBe(both.png <= both.jpeg ? 'image/png' : 'image/jpeg');
    expect(picked.buffer.byteLength).toBe(Math.min(both.png, both.jpeg));

    // The veto: one transparent pixel and JPEG is off the table, alpha included.
    const holed = await holedTemplate(200, { x: 20, y: 20, width: 60, height: 60 });
    const vetoed = await chooseEncode(holed, 90);
    expect(vetoed.mimeType).toBe('image/png');
    expect(await alphaAt(vetoed.buffer, 40, 40)).toBe(0);
    expect(await alphaAt(vetoed.buffer, 10, 10)).toBe(255);

    // The preset's quality actually reaches the encoder.
    const soft = await chooseEncode(noisy, 85);
    const tight = await chooseEncode(noisy, 95);
    expect(tight.buffer.byteLength).toBeGreaterThan(soft.buffer.byteLength);
  });
});
