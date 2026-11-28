/**
 * Task 8 — the studio fields on the two existing write routes.
 *
 * Two properties hold this file together.
 *
 * 1. **Validation runs before the byte transfer.** The create route's own comment
 *    already states the rule for `connectContestId` (`route.ts:161-170`): a request
 *    that is going to be refused must not leave a frame in the bucket. A studio
 *    field is the same shape of mistake — an admin can type `blendPreset=vivid` as
 *    easily as a slug — so the studio gate sits beside the UUID gate, not after the
 *    upload. These tests assert `uploadKeys` is empty, which is the only way to
 *    catch a re-order later.
 *
 * 2. **D6 freezes a published row as a whole.** An `active` template is the row
 *    `contest_photo_assets.template_id` points at and the row whose
 *    `blend_preset`/`blend_settings` explain a delivered photograph, so a partial
 *    studio write is worse than a refused one: the admin would see one slider moved
 *    and one not. The route refuses before building the update object, and the
 *    409 test asserts `updatePayload` stays null because of it.
 *
 * Non-studio PATCHes keep working unchanged. That is not laziness: the shipped
 * `frontend-admin` editor sends `{name, width, height, aspectRatio, status}` and
 * knows nothing about the studio fields (spec §6), so tightening those would break
 * the console mid-release for a field nobody has written yet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/src/server/admin/auth', () => ({ assertAdminPermission: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import { POST as createPOST } from '@/app/api/admin/voting/contest-templates/route';
import {
  GET as itemGET,
  PATCH as itemPATCH,
} from '@/app/api/admin/voting/contest-templates/[templateId]/route';
import { PUT as slotsPUT } from '@/app/api/admin/voting/contest-templates/[templateId]/slots/route';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { makeSupabase } from './_contest-template-fake';

const CONTEST_UUID = '7f0f1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b';
const ADMIN_UUID = '9c0d1e2f-3c4d-5e6f-7a8b-7f0f1a2b3c4d';

function ctx(templateId = 'tpl-1') {
  return { params: Promise.resolve({ templateId }) };
}

function pngFile() {
  return new File(['fake-png-bytes'], 'frame.png', { type: 'image/png' });
}

/** `multipartReq` for the create route: FormData values are always strings. */
function createReq(fields: Record<string, string>) {
  const fd = new FormData();
  fd.set('name', 'Grand Finale Frame');
  fd.set('connectContestId', CONTEST_UUID);
  fd.set('file', pngFile());
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return new Request('https://x.test/api/admin/voting/contest-templates', { method: 'POST', body: fd });
}

function patchReq(body: unknown) {
  return new Request('https://x.test/api/admin/voting/contest-templates/tpl-1', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

function draftRow(over: Record<string, unknown> = {}) {
  return {
    id: 'tpl-1', name: 'Frame', connect_contest_id: CONTEST_UUID, contest_id: null,
    template_url: 'https://cdn.test/templates/x.png', file_format: 'png', width: 1080, height: 1080,
    aspect_ratio: '1:1', status: 'draft', version: 1, created_by: ADMIN_UUID,
    photo_mode: 'auto', blend_preset: 'natural', blend_settings: { featherPx: 1 },
    published_at: null, published_by: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(assertAdminPermission).mockResolvedValue({ actorId: ADMIN_UUID, role: 'super_admin' } as any);
});

describe('studio fields on create', () => {
  it('stores all three and answers the params the render will use', async () => {
    const { client, calls } = makeSupabase({
      insertedTemplate: draftRow({ photo_mode: 'background', blend_preset: 'studio', blend_settings: { featherPx: 2 } }),
    });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await createPOST(
      createReq({ photoMode: 'background', blendPreset: 'studio', blendSettings: '{"featherPx":2}' }),
    );
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(calls.insertPayload).toMatchObject({
      photo_mode: 'background',
      blend_preset: 'studio',
      blend_settings: { featherPx: 2 },
      status: 'draft',
    });
    expect(body.template.blendPreset).toBe('studio');
    // Spec §6: `effective_params` is what D5 promised the admin — the number the
    // renderer will use, not the number that was typed.
    expect(body.effectiveParams.preset).toBe('studio');
    expect(body.effectiveParams.featherPx).toBe(2);
  });

  it('refuses a non-number override before a single byte is uploaded', async () => {
    const { client, calls } = makeSupabase({});
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await createPOST(createReq({ blendSettings: '{"featherPx":"two"}' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('blend_setting_not_a_number');
    expect(calls.uploadKeys, 'a refused create must not write to the bucket').toHaveLength(0);
    expect(calls.insertPayload).toBeNull();
  });

  it('refuses an unknown override naming the key, and an unknown preset', async () => {
    for (const [fields, code] of [
      [{ blendSettings: '{"teeth":1}' }, 'blend_setting_unknown'],
      [{ blendSettings: '{"featherPx":2' }, 'blend_settings_not_json'],
      [{ blendPreset: 'vivid' }, 'blend_preset_invalid'],
      [{ photoMode: 'blur' }, 'photo_mode_invalid'],
    ] as [Record<string, string>, string][]) {
      const { client, calls } = makeSupabase({});
      vi.mocked(createAdminClient).mockReturnValue(client);

      const res = await createPOST(createReq(fields));
      expect(res.status, JSON.stringify(fields)).toBe(400);
      expect((await res.json()).code, JSON.stringify(fields)).toBe(code);
      expect(calls.uploadKeys, `${code} must be caught before the upload`).toHaveLength(0);
    }
  });

  it('reads an empty form part as "not chosen", not as an invalid value', async () => {
    // A `<select>` the admin never touched submits an empty string. Refusing that
    // would make creating a template impossible for a client that renders the field
    // unselected, and both columns already have defaults to fall back to.
    const { client, calls } = makeSupabase({ insertedTemplate: draftRow() });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await createPOST(createReq({ photoMode: '', blendPreset: '', blendSettings: '' }));
    expect(res.status).toBe(201);
    expect(calls.insertPayload).not.toHaveProperty('photo_mode');
    expect(calls.insertPayload).not.toHaveProperty('blend_settings');
  });

  it('stores a clamped ceiling and reports it, rather than storing 99', async () => {
    const { client, calls } = makeSupabase({ insertedTemplate: draftRow() });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await createPOST(createReq({ blendSettings: '{"featherPx":99}' }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(calls.insertPayload.blend_settings).toEqual({ featherPx: 2 });
    expect(body.clamped).toEqual(['featherPx']);
    expect(body.effectiveParams.featherPx).toBe(2);
  });

  it('leaves the column defaults alone when no studio field is sent', async () => {
    // Old callers (the shipped console) post three fields. The route must not
    // invent studio values: photo_mode/blend_preset have column defaults, and
    // writing an explicit 'auto' from the BFF would make the default untestable.
    const { client, calls } = makeSupabase({ insertedTemplate: draftRow() });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await createPOST(createReq({}));
    expect(res.status).toBe(201);
    expect(calls.insertPayload).not.toHaveProperty('photo_mode');
    expect(calls.insertPayload).not.toHaveProperty('blend_preset');
    expect(calls.insertPayload).not.toHaveProperty('blend_settings');
    expect((await res.json()).effectiveParams.preset).toBe('natural');
  });
});

describe('D6: studio fields are writable on draft rows only', () => {
  it('writes photo_mode on a draft', async () => {
    const { client, calls } = makeSupabase({
      templateRow: draftRow(),
      updatedTemplate: draftRow({ photo_mode: 'background' }),
    });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await itemPATCH(patchReq({ photoMode: 'background' }), ctx('tpl-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(calls.updatePayload).toEqual({ photo_mode: 'background' });
    expect(body.template.photoMode).toBe('background');
    // The effective params are the render's own shape (spec §5 D5): preset + the
    // 16 knobs, never the photo mode, which selects a placement path rather than
    // a blend number.
    expect(body.effectiveParams.preset).toBe('natural');
    expect(body.effectiveParams).not.toHaveProperty('photoMode');
  });

  it('clamps a blendSettings override on a draft instead of storing it raw', async () => {
    const { client, calls } = makeSupabase({ templateRow: draftRow(), updatedTemplate: draftRow() });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await itemPATCH(patchReq({ blendSettings: { dropOpacity: 0.9 } }), ctx('tpl-1'));
    expect(res.status).toBe(200);
    // An object body is legal too — PATCH is JSON, not multipart.
    expect(calls.updatePayload).toEqual({ blend_settings: { dropOpacity: 0.28 } });
    expect((await res.json()).clamped).toEqual(['dropOpacity']);
  });

  it('refuses a studio write on an active row and writes nothing at all', async () => {
    const { client, calls } = makeSupabase({ templateRow: draftRow({ status: 'active' }) });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await itemPATCH(patchReq({ name: 'Renamed', photoMode: 'photo_area' }), ctx('tpl-1'));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('template_is_published');
    // Partial application is the bug this guards: `name` alone would have been a
    // legal write, and the admin could not tell which half landed.
    expect(calls.updatePayload).toBeNull();
    expect(body.error).toMatch(/duplicate/i);
  });

  it('refuses a studio write on an archived row: history keeps its explanation', async () => {
    const { client, calls } = makeSupabase({ templateRow: draftRow({ status: 'archived' }) });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await itemPATCH(patchReq({ blendPreset: 'bold' }), ctx('tpl-1'));
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('template_is_published');
    expect(calls.updatePayload).toBeNull();
  });

  it('still archives and still renames a published row — the gate is about studio fields', async () => {
    // Two shipped behaviours D6 must not disturb: `status` is lifecycle, not a
    // rendering parameter (spec §5 D6), and the console's numeric editor sends
    // name/width/height today (spec §6). Blocking either would strand an active
    // template that can no longer be archived — and DELETE refuses active rows.
    const { client, calls } = makeSupabase({ templateRow: draftRow({ status: 'active' }) });
    vi.mocked(createAdminClient).mockReturnValue(client);
    const archived = await itemPATCH(patchReq({ status: 'archived' }), ctx('tpl-1'));
    expect(archived.status).toBe(200);
    expect(calls.updatePayload).toEqual({ status: 'archived' });

    const { client: c2, calls: calls2 } = makeSupabase({ templateRow: draftRow({ status: 'active' }) });
    vi.mocked(createAdminClient).mockReturnValue(c2);
    const renamed = await itemPATCH(patchReq({ name: 'Renamed' }), ctx('tpl-1'));
    expect(renamed.status).toBe(200);
    expect(calls2.updatePayload).toEqual({ name: 'Renamed' });
  });

  it('refuses a malformed studio value on an active row as a studio refusal, not a 409', async () => {
    // Order matters for the message the admin gets: 'vivid' is wrong whatever the
    // row's status, and a 409 would send them off to duplicate a template before
    // discovering the preset name is the problem.
    const { client } = makeSupabase({ templateRow: draftRow({ status: 'active' }) });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await itemPATCH(patchReq({ blendPreset: 'vivid' }), ctx('tpl-1'));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('blend_preset_invalid');
  });
});

describe('studio fields read back', () => {
  it('GET exposes photoMode, blendPreset, blendSettings, publishedAt, publishedBy', async () => {
    const row = draftRow({ status: 'active', published_at: '2026-02-01T00:00:00Z', published_by: ADMIN_UUID });
    const { client } = makeSupabase({ templateRow: row });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await itemGET(new Request('https://x.test/api/admin/voting/contest-templates/tpl-1'), ctx('tpl-1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.template).toMatchObject({
      photoMode: 'auto',
      blendPreset: 'natural',
      blendSettings: { featherPx: 1 },
      publishedAt: '2026-02-01T00:00:00Z',
      publishedBy: ADMIN_UUID,
    });
  });
});

/**
 * Task 9 — slot art survives (or is deliberately removed by) a PUT that replaces
 * the whole list.
 *
 * PUT's semantics are what make this dangerous: the route deletes every row and
 * re-inserts, so a field the payload does not carry is a field the database drops.
 * The old console has thirteen geometry fields and no idea `image_url` exists, so a
 * geometry-only PUT of a template whose art was set from the studio would delete
 * that art with no error anywhere. Two rules close it, and the tests below are
 * exactly the two rules:
 *
 * - a payload that **does not mention art at all** keeps every stored art url
 *   (`slot_art_would_be_dropped` refuses the replace instead), and
 * - a payload that **does** mention art is the studio's own, so its `null` is read
 *   as an intentional clear and its writes obey D6 (`draft` rows only).
 *
 * The defaults assertion is the other half of the round-trip: omitting `anchor`
 * must produce the same stored row as sending `'auto'`, and the route says so in
 * the payload rather than relying on a column default it then cannot report.
 */
describe('slot art round-trips through PUT', () => {
  const slotArtUrl =
    'http://127.0.0.1:54321/storage/v1/object/public/contest-templates/slots/tpl-1/art.png';

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  });

  function baseSlot(over: Record<string, unknown> = {}) {
    return {
      slotName: 'Center', slotType: 'contestant', slotOrder: 1, x: 120, y: 240,
      width: 600, height: 800, rotation: 0, zIndex: 2, scale: 1, cropMode: 'cover',
      borderRadius: 12, opacity: 1,
      ...over,
    };
  }

  function slotsReq(slots: unknown[]) {
    return new Request('https://x.test/api/admin/voting/contest-templates/tpl-1/slots', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slots }),
    });
  }

  /** `cleared` is the tell that matters: a refusal must never have run the delete. */
  function expectNothingCleared(deletedFrom: string[]) {
    expect(deletedFrom, 'a refused replace must not clear the table first').not.toContain('template_slots');
  }

  it('stores the four art fields and answers them back', async () => {
    const { client, calls } = makeSupabase({ templateRow: draftRow(), existingSlots: [] });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await slotsPUT(
      slotsReq([baseSlot({ imageUrl: slotArtUrl, anchor: 'centre', bleed: true, faceProtect: false })]),
      ctx('tpl-1'),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(calls.insertRows).toHaveLength(1);
    expect(calls.insertRows![0]).toMatchObject({
      image_url: slotArtUrl,
      anchor: 'centre',
      bleed: true,
      face_protect: false,
    });
    expect(body.slots[0]).toMatchObject({
      imageUrl: slotArtUrl,
      anchor: 'centre',
      bleed: true,
      faceProtect: false,
    });
  });

  it('writes the column defaults for the fields a plain geometry payload omits', async () => {
    const { client, calls } = makeSupabase({ templateRow: draftRow(), existingSlots: [] });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await slotsPUT(slotsReq([baseSlot()]), ctx('tpl-1'));

    expect(res.status).toBe(200);
    // Stated in the row, not left to the DDL: the response has to describe what
    // was stored, and `mapSlotRow` reads these columns back.
    expect(calls.insertRows![0]).toMatchObject({
      image_url: null,
      anchor: 'auto',
      bleed: false,
      face_protect: true,
    });
  });

  it('refuses art hosted outside the renderer’s trust rule before clearing anything', async () => {
    const { client, calls } = makeSupabase({ templateRow: draftRow(), existingSlots: [] });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await slotsPUT(slotsReq([baseSlot({ imageUrl: 'https://evil.test/x.png' })]), ctx('tpl-1'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('slot_image_not_readable');
    expect(body.error).toMatch(/renderer/i);
    expect(calls.insertRows).toBeNull();
    expectNothingCleared(calls.deletedFrom);
  });

  it('refuses an anchor the column would reject, and a non-boolean flag', async () => {
    for (const [over, code] of [
      [{ anchor: 'middle' }, 'slot_anchor_invalid'],
      [{ anchor: 'center' }, 'slot_anchor_invalid'],
      [{ bleed: 'maybe' }, 'slot_flag_invalid'],
      [{ faceProtect: 1 }, 'slot_flag_invalid'],
    ] as [Record<string, unknown>, string][]) {
      const { client, calls } = makeSupabase({ templateRow: draftRow(), existingSlots: [] });
      vi.mocked(createAdminClient).mockReturnValue(client);

      const res = await slotsPUT(slotsReq([baseSlot(over)]), ctx('tpl-1'));
      expect(res.status, JSON.stringify(over)).toBe(400);
      expect((await res.json()).code, JSON.stringify(over)).toBe(code);
      expectNothingCleared(calls.deletedFrom);
    }
  });

  it('refuses to drop stored art that a payload unaware of art does not repeat', async () => {
    const { client, calls } = makeSupabase({
      templateRow: draftRow(),
      existingSlots: [{ id: 'slot-1', slot_name: 'Center', image_url: slotArtUrl }],
    });
    vi.mocked(createAdminClient).mockReturnValue(client);

    // The shipped console's exact request: geometry only.
    const res = await slotsPUT(slotsReq([baseSlot()]), ctx('tpl-1'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('slot_art_would_be_dropped');
    expect(body.error, 'the message has to name the art at risk').toContain(slotArtUrl);
    expectNothingCleared(calls.deletedFrom);
  });

  it('lets a geometry payload through when no stored slot has art', async () => {
    const { client, calls } = makeSupabase({
      templateRow: draftRow(),
      existingSlots: [{ id: 'slot-1', slot_name: 'Center', image_url: null }],
    });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await slotsPUT(slotsReq([baseSlot()]), ctx('tpl-1'));

    expect(res.status).toBe(200);
    expect(calls.deletedFrom).toContain('template_slots');
  });

  it('honours an explicit null as the studio clearing art on purpose', async () => {
    const { client, calls } = makeSupabase({
      templateRow: draftRow(),
      existingSlots: [{ id: 'slot-1', slot_name: 'Center', image_url: slotArtUrl }],
    });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await slotsPUT(slotsReq([baseSlot({ imageUrl: null, anchor: 'centre' })]), ctx('tpl-1'));

    expect(res.status).toBe(200);
    expect(calls.insertRows![0].image_url).toBeNull();
    expect(calls.deletedFrom).toContain('template_slots');
  });

  it('keeps the stored art when the payload repeats it', async () => {
    const { client, calls } = makeSupabase({
      templateRow: draftRow(),
      existingSlots: [{ id: 'slot-1', slot_name: 'Center', image_url: slotArtUrl }],
    });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await slotsPUT(slotsReq([baseSlot({ imageUrl: slotArtUrl })]), ctx('tpl-1'));

    expect(res.status).toBe(200);
    expect(calls.insertRows![0].image_url).toBe(slotArtUrl);
  });

  it('refuses to write art onto a published template (D6)', async () => {
    const { client, calls } = makeSupabase({
      templateRow: draftRow({ status: 'active' }),
      existingSlots: [],
    });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await slotsPUT(slotsReq([baseSlot({ anchor: 'bottom' })]), ctx('tpl-1'));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.code).toBe('template_is_published');
    expect(body.error).toMatch(/Duplicate/i);
    expectNothingCleared(calls.deletedFrom);
  });

  it('still lets the shipped console edit geometry on an active template', async () => {
    const { client, calls } = makeSupabase({
      templateRow: draftRow({ status: 'active' }),
      existingSlots: [{ id: 'slot-1', slot_name: 'Center', image_url: null }],
    });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await slotsPUT(slotsReq([baseSlot({ x: 10, y: 20 })]), ctx('tpl-1'));

    expect(res.status).toBe(200);
    expect(calls.insertRows![0]).toMatchObject({ x: 10, y: 20, anchor: 'auto', image_url: null });
  });

  it('refuses a payload that manages art on one slot but forgets it on the stored one', async () => {
    // The case `ownsArt` exists for: a client that discovered `anchor` but not
    // `image_url`. Half-managing the art set is indistinguishable from forgetting
    // it, and the difference is one deleted overlay.
    const { client, calls } = makeSupabase({
      templateRow: draftRow(),
      existingSlots: [{ id: 'slot-1', slot_name: 'Center', image_url: slotArtUrl }],
    });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await slotsPUT(slotsReq([baseSlot({ anchor: 'top' })]), ctx('tpl-1'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.code).toBe('slot_art_would_be_dropped');
    expect(body.error).toContain(slotArtUrl);
    expectNothingCleared(calls.deletedFrom);
  });

  it('refuses to delete every slot of a template that has art', async () => {
    // An empty list has no slot left to carry `imageUrl: null`, so the studio has
    // to clear the art before emptying the template — two deliberate steps rather
    // than one destructive one.
    const { client, calls } = makeSupabase({
      templateRow: draftRow(),
      existingSlots: [{ id: 'slot-1', slot_name: 'Center', image_url: slotArtUrl }],
    });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await slotsPUT(slotsReq([]), ctx('tpl-1'));

    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('slot_art_would_be_dropped');
    expectNothingCleared(calls.deletedFrom);
  });

  it('keeps refusing to strip the last contestant slot from an active template', async () => {
    const { client, calls } = makeSupabase({
      templateRow: draftRow({ status: 'active' }),
      existingSlots: [{ id: 'slot-1', slot_name: 'Center', image_url: null }],
    });
    vi.mocked(createAdminClient).mockReturnValue(client);

    const res = await slotsPUT(slotsReq([baseSlot({ slotName: 'Badge', slotType: 'badge' })]), ctx('tpl-1'));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/contestant/i);
    expectNothingCleared(calls.deletedFrom);
  });
});
