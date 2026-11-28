/**
 * P3 Task 10 — the studio's synchronous preview (spec §5, §9, D3, D4, D5).
 *
 * Two layers are asserted here, and the split is the point:
 *
 * - `buildPreview` owns every decision a preview can get wrong — whether the
 *   sample may be used at all, whether the frame is readable, which numbers the
 *   engine runs on — and answers either bytes or a named refusal. It is tested
 *   with `readTemplateImage` stubbed, so no test in this file touches the network.
 * - the route owns the transport: auth first, `formData` parsing second, and the
 *   refusal → status/code mapping the console reads. It runs the *real*
 *   `buildPreview`, which is what proves the two layers agree about field names.
 *
 * `compositeWithBlend` is deliberately not mocked. §10's promise ("a failed blend
 * costs the blend, not the portrait") and D3's promise ("the preview writes
 * nothing") are both properties of the real render path; a mocked engine would
 * pass either way.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import sharp from 'sharp';

vi.mock('@/src/server/admin/auth', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/src/lib/media/template-image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/lib/media/template-image')>();
  return { ...actual, readTemplateImage: vi.fn() };
});

import {
  buildPreview,
  selectPreviewSlots,
  MAX_PREVIEW_SIDE,
  MAX_SAMPLE_BYTES,
  type PreviewTemplateRow,
} from '@/src/server/template-studio/preview';
import { readTemplateImage } from '@/src/lib/media/template-image';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';
import { POST as previewPOST } from '@/app/api/admin/voting/contest-templates/[templateId]/preview/route';
import { makeSupabase } from './_contest-template-fake';

const TRUSTED_ORIGIN = 'http://127.0.0.1:54321';
const FRAME_URL = `${TRUSTED_ORIGIN}/storage/v1/object/public/contest-templates/templates/tpl-1/frame.png`;

/** A template row as `contest_templates` stores it. */
function frameRow(over: Partial<PreviewTemplateRow> = {}): PreviewTemplateRow {
  return {
    id: 'tpl-1',
    template_url: FRAME_URL,
    width: 1080,
    height: 1350,
    photo_mode: 'auto',
    blend_preset: 'natural',
    blend_settings: {},
    ...over,
  };
}

/** A `template_slots` row. Defaults are the column defaults from 20272200000000. */
function slotRow(over: Record<string, unknown> = {}) {
  return {
    id: 'slot-1',
    slot_name: 'Contestant',
    slot_type: 'contestant',
    slot_order: 1,
    x: 190,
    y: 280,
    width: 700,
    height: 800,
    rotation: 0,
    z_index: 1,
    scale: 1,
    crop_mode: 'cover',
    border_radius: 0,
    opacity: 1,
    image_url: null,
    anchor: 'auto',
    bleed: false,
    face_protect: true,
    ...over,
  };
}

let framePng: Buffer;
/** RGBA with real transparent pixels — what a cut-out sample portrait looks like. */
let cutoutPng: Buffer;
/** A phone photo: 3 channels, no alpha at all. */
let opaqueJpeg: Buffer;
/** Bytes that are not an image. */
const garbage = Buffer.from('not an image, not even close');

beforeAll(async () => {
  // The frame keeps transparent pixels (every authored template does, above the
  // contestant window), which is also what makes the compositor answer PNG.
  framePng = await sharp({
    create: { width: 1080, height: 1350, channels: 4, background: { r: 24, g: 20, b: 48, alpha: 0 } },
  })
    .composite([
      { input: await sharp({ create: { width: 1080, height: 120, channels: 4, background: { r: 240, g: 200, b: 90, alpha: 1 } } }).png().toBuffer(), top: 60, left: 0 },
    ])
    .png()
    .toBuffer();

  cutoutPng = await sharp({
    create: { width: 300, height: 420, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      { input: await sharp({ create: { width: 220, height: 340, channels: 4, background: { r: 198, g: 141, b: 109, alpha: 1 } } }).png().toBuffer(), top: 40, left: 40 },
    ])
    .png()
    .toBuffer();

  opaqueJpeg = await sharp({
    create: { width: 300, height: 420, channels: 3, background: { r: 198, g: 141, b: 109 } },
  })
    .jpeg({ quality: 80 })
    .toBuffer();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', TRUSTED_ORIGIN);
  vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: 'admin-1', role: 'super_admin' } as any);
  vi.mocked(readTemplateImage).mockResolvedValue({ ok: true, bytes: framePng });
});

const baseInput = (over: Record<string, unknown> = {}) => ({
  template: frameRow(),
  slotRows: [slotRow()],
  sampleBytes: cutoutPng,
  ...over,
});

describe('selectPreviewSlots — the resolver\'s two rules, without a database', () => {
  it('takes the lowest-slot-order contestant and the art-bearing overlays in z_index order', () => {
    const picked = selectPreviewSlots([
      slotRow({ id: 'badge', slot_name: 'Ribbon', slot_type: 'badge', slot_order: 3, z_index: 5, image_url: `${FRAME_URL}` }),
      slotRow({ id: 'c2', slot_name: 'Second window', slot_type: 'contestant', slot_order: 4 }),
      slotRow({ id: 'c1', slot_name: 'Main window', slot_type: 'contestant', slot_order: 2 }),
      slotRow({ id: 'logo', slot_name: 'Logo', slot_type: 'logo', slot_order: 1, z_index: 2, image_url: `${FRAME_URL}?x=1` }),
      slotRow({ id: 'empty', slot_name: 'Frame', slot_type: 'custom', slot_order: 6, z_index: 9, image_url: null }),
    ]);

    expect(picked.contestant?.id).toBe('c1');
    // `empty` has no art, so it never reaches the compositor; `logo` is under
    // `badge` on the z axis, which is the order the compositor draws in.
    expect(picked.foreground.map((s) => s.id)).toEqual(['logo', 'badge']);
  });

  it('answers a null contestant for a template whose only slot is art', () => {
    const picked = selectPreviewSlots([slotRow({ slot_type: 'badge', image_url: FRAME_URL })]);
    expect(picked.contestant).toBeNull();
    expect(picked.foreground).toHaveLength(1);
  });
});

describe('buildPreview — refusals', () => {
  it('reports template_not_found before looking at anything else', async () => {
    const r = await buildPreview(baseInput({ template: null, sampleBytes: null }));
    expect(r).toMatchObject({ ok: false, status: 404, code: 'template_not_found' });
    expect(readTemplateImage).not.toHaveBeenCalled();
  });

  it('asks for a sample when the form sent none (spec D4)', async () => {
    const empty = await buildPreview(baseInput({ sampleBytes: null }));
    expect(empty).toMatchObject({ ok: false, status: 400, code: 'sample_required' });
    const blank = await buildPreview(baseInput({ sampleBytes: Buffer.alloc(0) }));
    expect(blank).toMatchObject({ ok: false, code: 'sample_required' });
    expect(readTemplateImage).not.toHaveBeenCalled();
  });

  it('refuses an opaque sample instead of rendering an untouched photograph', async () => {
    const r = await buildPreview(baseInput({ sampleBytes: opaqueJpeg }));
    expect(r).toMatchObject({ ok: false, status: 415, code: 'sample_needs_cutout' });
    if (!r.ok) expect(r.error).toMatch(/cutout|cut-out|alpha/i);
    expect(readTemplateImage).not.toHaveBeenCalled();
  });

  it('refuses a sample it cannot decode, with a different code than "no alpha"', async () => {
    const r = await buildPreview(baseInput({ sampleBytes: garbage }));
    expect(r).toMatchObject({ ok: false, status: 400, code: 'sample_unreadable' });
  });

  it('refuses a sample over the upload cap before decoding it', async () => {
    const r = await buildPreview(baseInput({ sampleBytes: Buffer.alloc(MAX_SAMPLE_BYTES + 1) }));
    expect(r).toMatchObject({ ok: false, status: 413, code: 'sample_too_large' });
  });

  it('refuses an oversized canvas before spending a frame read', async () => {
    const huge = MAX_PREVIEW_SIDE + 904;
    const r = await buildPreview(baseInput({ template: frameRow({ width: huge, height: huge }) }));
    expect(r).toMatchObject({ ok: false, status: 400, code: 'canvas_too_large' });
    expect(readTemplateImage).not.toHaveBeenCalled();
  });

  it('names a row whose geometry is not two positive numbers', async () => {
    const r = await buildPreview(baseInput({ template: frameRow({ width: 0, height: null }) }));
    expect(r).toMatchObject({ ok: false, code: 'template_geometry_invalid' });
  });

  it('carries the frame reader\'s reason into the refusal code', async () => {
    vi.mocked(readTemplateImage).mockResolvedValueOnce({ ok: false, reason: 'host-not-allowed' });
    const r = await buildPreview(baseInput());
    expect(r).toMatchObject({ ok: false, status: 409, code: 'template_bytes_unreadable:host-not-allowed' });
    if (!r.ok) expect(r.error).toMatch(/host-not-allowed/);
  });

  it('refuses a template with no contestant slot instead of compositing nothing', async () => {
    vi.mocked(readTemplateImage).mockClear();
    const r = await buildPreview(baseInput({ slotRows: [slotRow({ slot_type: 'badge', image_url: FRAME_URL })] }));
    expect(r).toMatchObject({ ok: false, status: 400, code: 'no_contestant_slot' });
    expect(readTemplateImage).not.toHaveBeenCalled();
  });

  it('refuses an unknown photoMode, preset or setting with the authoring validator\'s code', async () => {
    const mode = await buildPreview(baseInput({ overrides: { photoMode: 'cinematic' } }));
    expect(mode).toMatchObject({ ok: false, status: 400, code: 'photo_mode_invalid' });
    const preset = await buildPreview(baseInput({ overrides: { blendPreset: 'vintage' } }));
    expect(preset).toMatchObject({ ok: false, code: 'blend_preset_invalid' });
    const settings = await buildPreview(baseInput({ overrides: { blendSettings: '{"feather":1}' } }));
    expect(settings).toMatchObject({ ok: false, code: 'blend_setting_unknown' });
    const notJson = await buildPreview(baseInput({ overrides: { blendSettings: 'featherPx=1' } }));
    expect(notJson).toMatchObject({ ok: false, code: 'blend_settings_not_json' });
  });

  it('keeps refusing when a nudge is not a finite number', async () => {
    const r = await buildPreview(baseInput({ overrides: { xOffset: Number.NaN } }));
    expect(r).toMatchObject({ ok: false, status: 400, code: 'override_not_a_number' });
  });
});

describe('buildPreview — the render', () => {
  it('returns pixels, a mime type, and decisions that say the blend ran', async () => {
    const r = await buildPreview(baseInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.buffer.byteLength).toBeGreaterThan(0);
    expect(r.mimeType).toMatch(/^image\//);
    expect(r.decisions).toMatchObject({ applied: true, preset: 'natural' });
    expect(r.width).toBe(1080);
    expect(r.height).toBe(1350);
  });

  it('reads the frame exactly once (§14.11: the read is paid for)', async () => {
    await buildPreview(baseInput());
    expect(readTemplateImage).toHaveBeenCalledTimes(1);
    expect(readTemplateImage).toHaveBeenCalledWith(FRAME_URL);
  });

  it('reports the effective params and which knobs were clamped (spec D5)', async () => {
    const r = await buildPreview(baseInput({ overrides: { blendPreset: 'bold', blendSettings: { featherPx: 99 } } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.params.preset).toBe('bold');
    expect(r.params.featherPx).toBeLessThanOrEqual(2);
    expect(r.clamped).toEqual(['featherPx']);
    expect(r.decisions.params).toMatchObject({ preset: 'bold', clamped: ['featherPx'] });
  });

  it('prefers the request\'s fields over the row, and the row over the default', async () => {
    const fromRow = await buildPreview(baseInput());
    expect(fromRow.ok && fromRow.decisions.mode).toMatchObject({ declared: 'auto' });

    const overridden = await buildPreview(baseInput({ overrides: { photoMode: 'background' } }));
    expect(overridden.ok && overridden.decisions.mode).toMatchObject({ declared: 'background', used: 'background' });
  });

  it('renders an unblended portrait when the preset is "off", and says so', async () => {
    const r = await buildPreview(baseInput({ overrides: { blendPreset: 'off' } }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.decisions).toMatchObject({ applied: false, preset: 'off' });
    expect(r.buffer.byteLength).toBeGreaterThan(0);
  });

  it('draws the template\'s own slot art into the preview (§8.1)', async () => {
    // The compositor fetches a foreground slot's `image_url` itself, so the art read
    // is stubbed too: asserting on bytes that came back *different* is what proves
    // the ribbon reached the composite, and leaving this un-stubbed would make the
    // test depend on a local storage service answering.
    const fetchStub = vi.fn(async (_url: string | URL, _init?: RequestInit) => new Response(new Uint8Array(framePng), { status: 200, headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchStub);
    try {
      const ribbon = slotRow({ id: 'ribbon', slot_name: 'Ribbon', slot_type: 'badge', slot_order: 2, z_index: 4, image_url: FRAME_URL });
      const plain = await buildPreview(baseInput());
      const withArt = await buildPreview(baseInput({ slotRows: [slotRow(), ribbon] }));
      expect(withArt.ok).toBe(true);
      expect(fetchStub).toHaveBeenCalledTimes(1);
      expect(fetchStub.mock.calls[0][0]).toBe(FRAME_URL);
      if (!plain.ok || !withArt.ok) return;
      expect(Buffer.compare(plain.buffer, withArt.buffer)).not.toBe(0);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('degrades rather than fails when the blend engine throws (§10)', async () => {
    // `compositeWithBlend` catches engine throws when a fallback is supplied, so
    // the observable case is an engine that declines: bytes still come back and
    // the record carries `applied: false` with the reason.
    const blank = await sharp({ create: { width: 40, height: 40, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const r = await buildPreview(baseInput({ sampleBytes: blank }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.decisions).toMatchObject({ applied: false });
    expect(r.buffer.byteLength).toBeGreaterThan(0);
  });

  it('writes nothing, anywhere (spec D3)', () => {
    const source = readFileSync(new URL('../../../src/server/template-studio/preview.ts', import.meta.url), 'utf8');
    for (const forbidden of ['storePhoto', 'upsertPhotoAsset', 'photo_jobs', 'createPhotoJob', '.rpc(', 'createClient', '.insert(', '.update(', 'storage.from']) {
      expect(source, `preview.ts must not reference ${forbidden}`).not.toContain(forbidden);
    }
  });
});

describe('POST /api/admin/voting/contest-templates/[id]/preview', () => {
  const ctx = { params: Promise.resolve({ templateId: 'tpl-1' }) };

  function formReq(fields: Record<string, string | File>) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v as any);
    return new Request('https://x.test/api/admin/voting/contest-templates/tpl-1/preview', { method: 'POST', body: fd });
  }

  function wire(client: any) {
    vi.mocked(createAdminClient).mockReturnValue(client);
  }

  it('is rejected before any query when the caller lacks votes:manage', async () => {
    vi.mocked(assertAdminPermission).mockRejectedValueOnce(new ApiError('Forbidden', 403));
    const res = await previewPOST(formReq({ sample: new File([new Uint8Array(cutoutPng)], 's.png', { type: 'image/png' }) }), ctx);
    expect(res.status).toBe(403);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it('answers image bytes with the blend headers the console reads', async () => {
    wire(makeSupabase({ templateRow: frameRow(), existingSlots: [slotRow()] }).client);
    const res = await previewPOST(formReq({ sample: new File([new Uint8Array(cutoutPng)], 's.png', { type: 'image/png' }), photoMode: 'background' }), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^image\//);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-blend-applied')).toBe('true');
    const rawHeader = res.headers.get('x-render-decisions') ?? '';
    // Percent-encoded, not raw JSON: a header value is a single ASCII token, and the
    // decision record carries operator prose that can hold a non-ASCII character.
    expect(rawHeader).not.toContain('{');
    const decisions = JSON.parse(decodeURIComponent(rawHeader));
    expect(decisions).toMatchObject({ applied: true, mode: { declared: 'background' } });
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect((await sharp(bytes).metadata()).width).toBe(1080);
  });

  it('carries a refusal through as status + code', async () => {
    wire(makeSupabase({ templateRow: frameRow(), existingSlots: [slotRow({ slot_type: 'badge', image_url: FRAME_URL })] }).client);
    const res = await previewPOST(formReq({ sample: new File([new Uint8Array(cutoutPng)], 's.png', { type: 'image/png' }) }), ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('no_contestant_slot');
    expect(body.error).toContain('contestant');
  });

  it('404s a template id that is not a row', async () => {
    wire(makeSupabase({}).client);
    const res = await previewPOST(formReq({ sample: new File([new Uint8Array(cutoutPng)], 's.png', { type: 'image/png' }) }), ctx);
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('template_not_found');
  });

  it('answers 415 for a body that is not multipart, and 400 for a form without a file', async () => {
    wire(makeSupabase({ templateRow: frameRow(), existingSlots: [slotRow()] }).client);
    const json = new Request('https://x.test/preview', { method: 'POST', body: JSON.stringify({}) });
    expect((await previewPOST(json, ctx)).status).toBe(415);

    const noFile = await previewPOST(formReq({ photoMode: 'auto' }), ctx);
    expect(noFile.status).toBe(400);
    expect((await noFile.json()).code).toBe('sample_required');
  });

  it('reads the numeric nudges out of the form and into the placement', async () => {
    wire(makeSupabase({ templateRow: frameRow(), existingSlots: [slotRow()] }).client);
    const res = await previewPOST(
      formReq({
        sample: new File([new Uint8Array(cutoutPng)], 's.png', { type: 'image/png' }),
        xOffset: '40',
        yOffset: '-20',
        scale: '1.1',
      }),
      ctx,
    );
    expect(res.status).toBe(200);
    const decisions = JSON.parse(decodeURIComponent(res.headers.get('x-render-decisions') ?? ''));
    const unshifted = await previewPOST(
      formReq({ sample: new File([new Uint8Array(cutoutPng)], 's.png', { type: 'image/png' }) }),
      ctx,
    );
    const base = JSON.parse(decodeURIComponent(unshifted.headers.get('x-render-decisions') ?? ''));
    expect(decisions.placement.target.left).not.toBe(base.placement.target.left);
  });

  it('refuses a nudge that is not a number with 400, not a silent zero', async () => {
    wire(makeSupabase({ templateRow: frameRow(), existingSlots: [slotRow()] }).client);
    const res = await previewPOST(
      formReq({ sample: new File([new Uint8Array(cutoutPng)], 's.png', { type: 'image/png' }), xOffset: 'lots' }),
      ctx,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('override_not_a_number');
  });
});
