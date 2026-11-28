/**
 * D5/D6 — the studio field layer (`src/server/template-studio/authoring.ts`).
 *
 * These tests exist to hold one property: the console may not store a blend
 * number that the renderer would then clamp behind the admin's back. Spec §5 D5
 * says the API refuses an unknown key and a non-number and answers with the
 * `effective_params` the render will actually use, so the validator has to share
 * `blend/params.ts`'s single `BOUNDS` table rather than keep a copy — a copy is
 * how a form and a renderer drift apart and the admin only finds out in the
 * rendered photo.
 *
 * The contrast worth naming: `resolveBlendParams` is the render-side resolver and
 * it DROPS anything malformed (a failed job is worse for a contestant than a
 * conservative blend). The validator is the write-side gate and it REFUSES the
 * same input, because a saved-but-ignored override is exactly the "looks
 * configured but isn't" trap this whole module keeps re-encountering. Same table,
 * opposite failure policy, deliberately.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';

vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn() }));

import {
  PHOTO_MODES,
  BLEND_PRESET_NAMES,
  SLOT_ANCHORS,
  validatePhotoMode,
  validateBlendPreset,
  validateBlendSettings,
  effectiveBlendParams,
  isEditableStatus,
  parseStudioTemplateFields,
  parseStudioSlotFields,
  uuidOr,
} from '@/src/server/template-studio/authoring';
import { BOUNDS, PRESETS, resolveBlendParams } from '@/src/lib/rendering/blend/params';
import { studioRpcFailure } from '@/app/api/admin/voting/contest-templates/_shared';

const ADMIN_UUID = '9c0d1e2f-3c4d-5e6f-7a8b-7f0f1a2b3c4d';

describe('D5: blend_settings validation', () => {
  it('refuses an unknown key and names it', () => {
    const verdict = validateBlendSettings({ featherPx: 1, teeth: 3 });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.code).toBe('blend_setting_unknown');
      expect(verdict.error).toContain('teeth');
    }
  });

  it('refuses a non-number value and names the key it tripped on', () => {
    const verdict = validateBlendSettings({ featherPx: 'two' });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.code).toBe('blend_setting_not_a_number');
      expect(verdict.error).toContain('featherPx');
    }
  });

  it('refuses a non-finite number for the same reason a form sends one', () => {
    for (const raw of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const verdict = validateBlendSettings({ subjectFill: raw });
      expect(verdict.ok, String(raw)).toBe(false);
      if (!verdict.ok) expect(verdict.code).toBe('blend_setting_not_a_number');
    }
  });

  it('refuses a shadow mode outside auto/on/off as blend_setting_invalid', () => {
    const verdict = validateBlendSettings({ shadow: 'loud' });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.code).toBe('blend_setting_invalid');
      expect(verdict.error).toContain('shadow');
    }
  });

  it('accepts each of the three shadow modes as itself, not as a number', () => {
    for (const mode of ['auto', 'on', 'off']) {
      const verdict = validateBlendSettings({ shadow: mode });
      expect(verdict.ok, mode).toBe(true);
      if (verdict.ok) expect(verdict.value).toEqual({ shadow: mode });
    }
  });

  it('clamps an out-of-bound number to the ceiling and reports the key', () => {
    const verdict = validateBlendSettings({ featherPx: 99 });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      // BOUNDS.featherPx is [0, 2]; the stored value must be the ceiling, so the
      // row and the render agree, and `clamped` is what tells the admin so.
      expect(verdict.value.featherPx).toBe(BOUNDS.featherPx?.[1]);
      expect(verdict.value.featherPx).toBe(2);
      expect(verdict.clamped).toEqual(['featherPx']);
    }
  });

  it('clamps below the floor too, and lists both keys in payload order', () => {
    const verdict = validateBlendSettings({ jpegQuality: 1, featherPx: -4 });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.value.jpegQuality).toBe(BOUNDS.jpegQuality?.[0]);
      expect(verdict.value.featherPx).toBe(0);
      expect(verdict.clamped).toEqual(['jpegQuality', 'featherPx']);
    }
  });

  it('leaves an in-bound number untouched and reports nothing clamped', () => {
    const verdict = validateBlendSettings({ featherPx: 1, dropOpacity: 0.2 });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.value).toEqual({ featherPx: 1, dropOpacity: 0.2 });
      expect(verdict.clamped).toEqual([]);
    }
  });

  it('parses a JSON string, because multipart fields only ever arrive as text', () => {
    const verdict = validateBlendSettings('{"featherPx":2}');
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.value).toEqual({ featherPx: 2 });
  });

  it('refuses a string that is not JSON, naming the field', () => {
    const verdict = validateBlendSettings('featherPx=2');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.code).toBe('blend_settings_not_json');
      expect(verdict.error).toContain('blendSettings');
    }
  });

  it('treats null, an empty string, and an array as "no overrides"', () => {
    for (const raw of [null, undefined, '', '   ', []]) {
      const verdict = validateBlendSettings(raw);
      expect(verdict.ok, JSON.stringify(raw)).toBe(true);
      if (verdict.ok) {
        expect(verdict.value).toEqual({});
        expect(verdict.clamped).toEqual([]);
      }
    }
  });

  it('refuses a nested object value as not a number', () => {
    const verdict = validateBlendSettings({ featherPx: { px: 2 } });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('blend_setting_not_a_number');
  });

  it('refuses the preset as a knob — it is identity, and has its own field', () => {
    const verdict = validateBlendSettings({ preset: 'bold' });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.code).toBe('blend_setting_unknown');
      expect(verdict.error).toContain('preset');
    }
  });

  it('accepts every key the renderer bounds, so the two lists cannot drift', () => {
    // Build a payload that touches every legal knob at its own bound. If the
    // validator ever grows a list of its own, a key only params.ts knows about
    // would come back here as blend_setting_unknown — which is the failure this
    // module had in its first draft and why the table is imported, not copied.
    const payload: Record<string, unknown> = { shadow: 'on' };
    for (const [key, bound] of Object.entries(BOUNDS)) payload[key] = bound[1];
    const verdict = validateBlendSettings(payload);
    expect(verdict.ok, JSON.stringify(verdict)).toBe(true);
    if (verdict.ok) {
      expect(Object.keys(verdict.value).sort()).toEqual([...Object.keys(BOUNDS), 'shadow'].sort());
    }
  });
});

describe('D5: photo_mode and blend_preset validation', () => {
  it('accepts the three photo modes the column CHECK allows', () => {
    for (const mode of PHOTO_MODES) {
      const verdict = validatePhotoMode(mode);
      expect(verdict.ok, mode).toBe(true);
      if (verdict.ok) expect(verdict.value).toBe(mode);
    }
  });

  it('refuses a photo mode outside the three', () => {
    const verdict = validatePhotoMode('blur');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.code).toBe('photo_mode_invalid');
      expect(verdict.error).toContain('blur');
    }
  });

  it('refuses a non-string photo mode rather than coercing it', () => {
    for (const raw of [1, null, {}, ['auto']]) {
      expect(validatePhotoMode(raw).ok, JSON.stringify(raw)).toBe(false);
    }
  });

  it('accepts the four presets resolveBlendParams ships', () => {
    for (const name of BLEND_PRESET_NAMES) {
      expect(validateBlendPreset(name).ok, name).toBe(true);
    }
    // Parity with the renderer's own table: a preset the render knows nothing
    // about must not be storable, and one it ships with must never be refused.
    expect([...BLEND_PRESET_NAMES].sort()).toEqual(Object.keys(PRESETS).sort());
  });

  it('refuses a preset outside the four', () => {
    const verdict = validateBlendPreset('vivid');
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.code).toBe('blend_preset_invalid');
      expect(verdict.error).toContain('vivid');
    }
  });
});

describe('D5: effective params', () => {
  it('resolves preset + settings into the numbers the render will use', () => {
    const params = effectiveBlendParams('studio', { featherPx: 99 });
    expect(params.preset).toBe('studio');
    expect(params.featherPx).toBe(2);
    // studio's own numbers survive: this is the resolved preset, not natural's.
    expect(params.subjectFill).toBe(PRESETS.studio.subjectFill);
    expect(params.lumaFraction).toBe(PRESETS.studio.lumaFraction);
  });

  it('falls back to natural for an unknown preset instead of throwing', () => {
    const params = effectiveBlendParams('vivid', null);
    expect(params).toEqual(PRESETS.natural);
  });

  it('ignores a rejected settings payload rather than storing half of it', () => {
    const params = effectiveBlendParams('bold', { teeth: 1 });
    expect(params).toEqual(PRESETS.bold);
  });

  it('agrees with the renderer for the same saved input', () => {
    const settings = { dropOpacity: 0.5, tempMax: 0.02, shadow: 'off' };
    const saved = validateBlendSettings(settings);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    // The stored JSON is what the runner will hand resolveBlendParams on the next
    // render. If the write gate clamped differently from the read resolver, the
    // preview and the delivered photo would disagree and neither would be wrong.
    expect(effectiveBlendParams('natural', saved.value)).toEqual(
      resolveBlendParams('natural', saved.value),
    );
  });
});

/**
 * The field layer is what a route hands a raw form/JSON body, so it owns the
 * "was this field actually filled in" question. `validateBlendSettings('')`
 * returning `{}` is correct for the validator — an empty override set is a legal
 * one — but the write must not turn a blank part into a stored `{}`: on PATCH the
 * column already holds the admin's overrides, and a form that posts an untouched
 * blank textarea would silently delete them.
 */
describe('D5: the field layer over a request body', () => {
  it('writes nothing when every studio field arrived blank', () => {
    const verdict = parseStudioTemplateFields({ photoMode: '', blendPreset: '', blendSettings: '' });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.updates).toEqual({});
      expect(verdict.clamped).toEqual([]);
    }
  });

  it('writes nothing when the body names none of the three', () => {
    // The shipped numeric editor PATCHes {name, width, height, aspectRatio, status}.
    const verdict = parseStudioTemplateFields({ name: 'Frame', status: 'draft' });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.updates).toEqual({});
  });

  it('takes only the fields that arrived with a value', () => {
    const verdict = parseStudioTemplateFields({ photoMode: 'background', blendPreset: '   ' });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.updates).toEqual({ photo_mode: 'background' });
  });

  it('reports the keys it clamped so the response can tell the admin', () => {
    const verdict = parseStudioTemplateFields({ blendSettings: '{"featherPx":99,"dropOpacity":0.1}' });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.updates.blend_settings).toEqual({ featherPx: 2, dropOpacity: 0.1 });
      expect(verdict.clamped).toEqual(['featherPx']);
    }
  });

  it('accepts a JSON object body too — PATCH is JSON, not multipart', () => {
    const verdict = parseStudioTemplateFields({ blendSettings: { speckleMinArea: 100, featherPx: 1 } });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.updates.blend_settings).toEqual({ speckleMinArea: 100, featherPx: 1 });
  });

  it('refuses the whole body on the first invalid field, listing nothing partial', () => {
    const verdict = parseStudioTemplateFields({ photoMode: 'blur', blendSettings: '{"teeth":1}' });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('photo_mode_invalid');
  });
});

describe('D6: which rows a studio write may touch', () => {
  it('allows drafts', () => {
    expect(isEditableStatus('draft')).toBe(true);
  });

  it('refuses active rows — the row a queue is keyed on stays byte-reproducible', () => {
    expect(isEditableStatus('active')).toBe(false);
  });

  it('refuses archived rows too, so history keeps describing the image it made', () => {
    // D6's heading is the rule ("writable on draft rows only"): an archived row
    // is still the row past contest_photo_assets rows point at, so rewriting its
    // blend settings would silently change what that history claims.
    expect(isEditableStatus('archived')).toBe(false);
  });

  it('refuses an unknown status rather than defaulting to writable', () => {
    expect(isEditableStatus('pending_review')).toBe(false);
    expect(isEditableStatus('')).toBe(false);
  });
});

describe('authoring helpers', () => {
  it('uuidOr keeps a real admin uuid and drops the x-admin-key placeholder', () => {
    expect(uuidOr(ADMIN_UUID)).toBe(ADMIN_UUID);
    // src/server/admin/auth.ts:77 answers 'api-key' for a server-to-server caller;
    // published_by/created_by are UUID columns, so that value must become null.
    expect(uuidOr('api-key')).toBeNull();
    expect(uuidOr(undefined)).toBeNull();
    expect(uuidOr(null)).toBeNull();
    expect(uuidOr(42)).toBeNull();
    expect(uuidOr('')).toBeNull();
  });

  it('maps a 22023 refusal to the RPC sentence the admin can act on', async () => {
    const res = studioRpcFailure('[admin/x PATCH]', {
      code: '22023',
      message: 'publish_contest_template: template "Finale" (abc) has no contestant slot — add one before publishing',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe('publish_needs_contestant_slot');
    // The whole point of `security definer` + hand-written raises: the sentence is
    // already addressed to the admin, so it travels verbatim (minus the fn prefix).
    expect(body.error).toContain('no contestant slot');
    expect(body.error).not.toContain('publish_contest_template:');
  });

  it('reads "no contest template … to publish" as a 404, not a 400', async () => {
    const res = studioRpcFailure('[admin/x PATCH]', {
      code: '22023',
      message: 'publish_contest_template: no contest template 7f0f1a2b-3c4d-5e6f-7a8b-9c0d1e2f3a4b to publish',
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('template_not_found');
  });

  it('answers the missing-function case as an unapplied migration, not a bad request', async () => {
    const res = studioRpcFailure('[admin/x PATCH]', {
      code: '42P01',
      message: 'function publish_contest_template(uuid, uuid) does not exist',
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('studio_rpc_missing');
    expect(body.error).toMatch(/migration/i);
  });

  it('keeps an unclassified RPC failure at 500 without echoing upstream text', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = studioRpcFailure('[admin/x PATCH]', {
      code: 'XX001',
      message: 'internal detail: relation "public.contest_templates" ...',
    });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('studio_rpc_failed');
    expect(body.error).not.toMatch(/contest_templates/);
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = spy.mock.calls[0].join(' ');
    expect(logged).toContain('[admin/x PATCH]');
    expect(logged).toContain('XX001');
    spy.mockRestore();
  });
});

describe('studio slot art fields (Task 9 consumes this)', () => {
  /**
   * The trust rule an `image_url` has to satisfy is the app's own
   * (`isAllowedRemoteImageUrl`): an https URL on the literal allowlist, or a
   * public object on the origin `configuredSupabaseOrigin()` returns — and that
   * reads `NEXT_PUBLIC_SUPABASE_URL`, the only Supabase URL the repo consumes.
   * Stubbing the dev value is what makes the URL below a real "our own bucket"
   * case instead of a test that passes because nothing was checked.
   */
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  });

  const slotUrl = 'http://127.0.0.1:54321/storage/v1/object/public/contest-templates/slots/tpl-1/art.png';

  it('says nothing when the payload mentions none of the four fields', () => {
    // This is the shipped numeric editor's payload shape: 13 slot fields, no art
    // fields. `{}` is what tells the caller "write none of the four columns" —
    // the alternative is a replace that silently resets art nobody touched.
    for (const raw of [{}, null, undefined, [], 'nope']) {
      const verdict = parseStudioSlotFields(raw);
      expect(verdict.ok, JSON.stringify(raw)).toBe(true);
      if (verdict.ok) expect(verdict.row).toEqual({});
    }
  });

  it('accepts the four anchors the column CHECK allows, British spelling included', () => {
    for (const anchor of SLOT_ANCHORS) {
      const verdict = parseStudioSlotFields({ anchor });
      expect(verdict.ok, anchor).toBe(true);
      if (verdict.ok) expect(verdict.row).toEqual({ anchor });
    }
    // 'center' is the spelling an American admin types and the column refuses; the
    // refusal has to name both the bad value and the legal list.
    const verdict = parseStudioSlotFields({ anchor: 'center' });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.code).toBe('slot_anchor_invalid');
      expect(verdict.error).toContain('center');
      expect(verdict.error).toContain('centre');
    }
  });

  it('accepts a readable slot image and keeps the value verbatim', () => {
    const verdict = parseStudioSlotFields({ imageUrl: slotUrl });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.row.image_url).toBe(slotUrl);
  });

  it('refuses an image the compositing readers would not fetch, naming why', () => {
    const verdict = parseStudioSlotFields({ imageUrl: 'https://evil.example.test/x.png' });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.code).toBe('slot_image_not_readable');
      expect(verdict.error).toContain('host-not-allowed');
    }
  });

  it('refuses blank text as neither a URL nor a clear', () => {
    const verdict = parseStudioSlotFields({ imageUrl: '   ' });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.code).toBe('slot_image_not_readable');
  });

  it('keeps an explicit null as "clear the art", which is not the same as omitting it', () => {
    const verdict = parseStudioSlotFields({ imageUrl: null });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.row).toEqual({ image_url: null });
  });

  it('coerces only the two words a form sends for a boolean', () => {
    const verdict = parseStudioSlotFields({ bleed: 'true', faceProtect: false, anchor: 'top' });
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.row).toEqual({ bleed: true, face_protect: false, anchor: 'top' });

    for (const raw of ['yes', 1, 'falsey', {}]) {
      const bad = parseStudioSlotFields({ bleed: raw });
      expect(bad.ok, JSON.stringify(raw)).toBe(false);
      if (!bad.ok) expect(bad.code).toBe('slot_flag_invalid');
    }
  });
});

/**
 * The field lists are also enforced by `20272200000000_contest_photo_blend.sql`'s
 * CHECK constraints, and a mismatch between the two is a 500 on save: the route
 * validated, Postgres disagreed. Pin them against the migration text the same way
 * `contest-template-bucket-policy.spec.ts` pins the mime allowlist.
 */
describe('studio field lists match the column CHECK constraints', () => {
  const migration = fileURLToPath(new URL('../../../../supabase/migrations/20272200000000_contest_photo_blend.sql', import.meta.url));

  it.each([
    ['photo_mode', PHOTO_MODES],
    ['blend_preset', BLEND_PRESET_NAMES],
    ['anchor', SLOT_ANCHORS],
  ])('%s: the validator accepts exactly what the column allows', (column, names) => {
    expect(existsSync(migration), `migration at ${migration}`).toBe(true);
    const sql = readFileSync(migration, 'utf8');
    const declared = sql.match(new RegExp(`${column} IN \\(([^)]*)\\)`))?.[1] ?? '';
    const fromSql = [...declared.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(fromSql.length, `no CHECK list found for ${column}`).toBeGreaterThan(0);
    expect([...names].sort()).toEqual(fromSql.sort());
  });
});
