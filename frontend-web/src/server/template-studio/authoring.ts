/**
 * The studio field layer (spec §4, §5 D5/D6).
 *
 * One file owns every answer to "may this value be stored, and what will the
 * renderer do with it". Both write routes — `POST /contest-templates` (multipart,
 * so every value arrives as text) and `PATCH /contest-templates/[id]` (JSON, so a
 * value can arrive as a real object or a string) — go through it, which is the only
 * reason their validation can be the same validation. `Task 9`'s slot writer and
 * `Task 11`'s lifecycle routes read it here for the same reason.
 *
 * Two rules this module encodes:
 *
 * - **The bounds come from the renderer.** `blend/params.ts` is the table the
 *   compositor resolves against, so it is imported, never copied. An out-of-bound
 *   number is clamped to it and the clamped key is reported (`clamped`), because
 *   D5's point is that the admin learns the number that will actually render — a
 *   form that stored `featherPx: 99` would be writing rendering policy, then
 *   quietly ignoring it.
 * - **The write gate refuses what the render resolver drops.**
 *   `resolveBlendParams` is deliberately forgiving (a failed job hurts a
 *   contestant; a conservatively blended photo does not). The API is deliberately
 *   not: an override that will never be applied has to be an error at save time.
 *   Same table, opposite failure policy, on purpose.
 *
 * Nothing here throws, and nothing here touches the database — the RPC calls live
 * in the lifecycle routes and in `_shared.ts` beside `studioRpcFailure`, so these functions stay testable without a
 * client.
 */
import {
  BOUNDS,
  PRESETS,
  SHADOW_MODES,
  resolveBlendParams,
  type BlendParams,
  type BlendPresetName,
  type ShadowMode,
} from '@/lib/rendering/blend/params';
import { templateImagePlan } from '@/lib/media/template-image';

/** Verbatim from `20272200000000_contest_photo_blend.sql:19-20`'s CHECK list. */
export const PHOTO_MODES = ['auto', 'background', 'photo_area'] as const;
export type PhotoMode = (typeof PHOTO_MODES)[number];

/** Derived from the renderer's own table so a fifth preset cannot be refused. */
export const BLEND_PRESET_NAMES = Object.keys(PRESETS) as BlendPresetName[];

/** Verbatim from `20272200000000_contest_photo_blend.sql:28`'s CHECK list. */
export const SLOT_ANCHORS = ['auto', 'top', 'centre', 'bottom'] as const;
export type SlotAnchor = (typeof SLOT_ANCHORS)[number];

export type FieldVerdict = { ok: true; value: unknown } | { ok: false; code: string; error: string };

export type BlendSettingsVerdict =
  | { ok: true; value: Record<string, unknown>; clamped: string[] }
  | { ok: false; code: string; error: string };

export type StudioFieldsVerdict =
  | {
      ok: true;
      /** Only the columns the caller actually sent, in `snake_case` storage shape. */
      updates: Record<string, unknown>;
      /** Which override keys were clamped to their bound, in payload order. */
      clamped: string[];
    }
  | { ok: false; code: string; error: string };

export type SlotFieldsVerdict =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; code: string; error: string };

/** `true` when `value` holds `key` — an explicit null counts as sent. */
function sent(body: Record<string, unknown>, key: string): boolean {
  return body[key] !== undefined;
}

/** A multipart part that is present but empty means "not chosen", not "invalid". */
function chosen(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? undefined : value;
}

function describeValue(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`;
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'a list';
  return typeof value;
}

export function validatePhotoMode(raw: unknown): FieldVerdict {
  if (typeof raw === 'string' && (PHOTO_MODES as readonly string[]).includes(raw)) {
    return { ok: true, value: raw };
  }
  return {
    ok: false,
    code: 'photo_mode_invalid',
    error:
      `photoMode must be one of ${PHOTO_MODES.join(', ')} — ${describeValue(raw)} is not a placement mode ` +
      'the compositor knows. "auto" decides from the template alpha.',
  };
}

export function validateBlendPreset(raw: unknown): FieldVerdict {
  if (typeof raw === 'string' && (BLEND_PRESET_NAMES as readonly string[]).includes(raw)) {
    return { ok: true, value: raw };
  }
  return {
    ok: false,
    code: 'blend_preset_invalid',
    error:
      `blendPreset must be one of ${BLEND_PRESET_NAMES.join(', ')} — ${describeValue(raw)} is not a preset ` +
      'in the blend table. "off" reproduces the plain paste exactly.',
  };
}

/**
 * Validate one `blend_settings` payload against the renderer's `BOUNDS`.
 *
 * Accepts an object or its JSON text — a PATCH sends an object, a multipart POST
 * can only send a string — and treats an absent, empty, or array payload as "no
 * overrides", which is what `resolveBlendParams` already does with them, so the
 * gate cannot disagree with the render about what an empty override set means.
 */
export function validateBlendSettings(raw: unknown): BlendSettingsVerdict {
  let source = raw;

  if (typeof source === 'string') {
    if (source.trim() === '') return { ok: true, value: {}, clamped: [] };
    try {
      source = JSON.parse(source);
    } catch {
      return {
        ok: false,
        code: 'blend_settings_not_json',
        error:
          'blendSettings must be a JSON object of blend overrides (for example {"featherPx":1}) — ' +
          'this value could not be parsed as JSON.',
      };
    }
  }

  if (source === null || source === undefined || Array.isArray(source)) {
    return { ok: true, value: {}, clamped: [] };
  }

  if (typeof source !== 'object') {
    return {
      ok: false,
      code: 'blend_setting_invalid',
      error: `blendSettings must be an object of blend overrides, not ${describeValue(source)}.`,
    };
  }

  const value: Record<string, unknown> = {};
  const clamped: string[] = [];

  for (const [key, entry] of Object.entries(source as Record<string, unknown>)) {
    if (key === 'shadow') {
      if (typeof entry !== 'string' || !(SHADOW_MODES as readonly string[]).includes(entry)) {
        return {
          ok: false,
          code: 'blend_setting_invalid',
          error: `'shadow' must be one of ${SHADOW_MODES.join(', ')} — ${describeValue(entry)} is not a shadow mode.`,
        };
      }
      value.shadow = entry;
      continue;
    }

    const bound = BOUNDS[key as keyof BlendParams];
    if (!bound) {
      // Includes `preset`, which is identity rather than a knob and has its own
      // field (`blendPreset`). Naming the key is the whole message: an admin who
      // typo'd `feather` wants to know which word the renderer did not recognise.
      return {
        ok: false,
        code: 'blend_setting_unknown',
        error:
          `"${key}" is not a blend setting. The renderer's knobs are: ` +
          `${[...Object.keys(BOUNDS), 'shadow'].join(', ')}.`,
      };
    }

    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      return {
        ok: false,
        code: 'blend_setting_not_a_number',
        error: `"${key}" must be a number — got ${describeValue(entry)}.`,
      };
    }

    const [min, max] = bound;
    const clampedValue = Math.min(max, Math.max(min, entry));
    if (clampedValue !== entry) clamped.push(key);
    value[key] = clampedValue;
  }

  return { ok: true, value, clamped };
}

/**
 * The `BlendParams` a render of this preset + these overrides will actually use.
 *
 * Answers the admin form (spec §6), and refuses nothing: a payload the validator
 * rejected resolves to the preset's own numbers, which is what the renderer would
 * have stored anyway. Call `validateBlendSettings` first when the caller needs a
 * yes/no.
 */
export function effectiveBlendParams(preset: unknown, settings: unknown): BlendParams {
  const name =
    typeof preset === 'string' && (BLEND_PRESET_NAMES as readonly string[]).includes(preset)
      ? preset
      : 'natural';
  const verdict = validateBlendSettings(settings);
  return resolveBlendParams(name, verdict.ok ? verdict.value : null);
}

/**
 * Which rows a studio write may touch (D6).
 *
 * `draft` only. An `active` row is the row a queued job resolves and a delivered
 * asset points at, so editing its blend settings would change what past renders
 * mean; an `archived` row is the same history one step later, which is why it is
 * refused too — D6's own heading is "writable on draft rows only", and the fix for
 * both is `duplicate`, which mints the new id D1 requires.
 *
 * Unknown statuses are refused rather than defaulted open: a new column value
 * should read as a bug in this function, not as permission.
 */
export function isEditableStatus(status: string): boolean {
  return status === 'draft';
}

/** A UUID or null — for columns that reference `user_profiles` (never 'api-key'). */
export function uuidOr(value: unknown): string | null {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

/**
 * Read the three studio template fields out of either request shape.
 *
 * Returns only the columns the caller sent, so a PATCH that touches `name` still
 * cannot write `blend_settings`, and a create that sends nothing still lets the
 * column defaults (`'auto'`, `'natural'`, `'{}'`) be the thing that applies — the
 * defaults are a database fact worth keeping observable.
 *
 * A part that arrived blank counts as "not sent" for all three fields, including
 * `blendSettings`. `validateBlendSettings('')` legitimately answers `{}` — an
 * empty override set is a legal set — but writing that on PATCH would erase the
 * overrides a draft already has, which is why the blank test lives in this layer
 * rather than in the validator.
 */
export function parseStudioTemplateFields(body: Record<string, unknown>): StudioFieldsVerdict {
  const updates: Record<string, unknown> = {};
  let clamped: string[] = [];

  if (sent(body, 'photoMode')) {
    const raw = chosen(body.photoMode);
    if (raw !== undefined) {
      const verdict = validatePhotoMode(raw);
      if (!verdict.ok) return verdict;
      updates.photo_mode = verdict.value;
    }
  }

  if (sent(body, 'blendPreset')) {
    const raw = chosen(body.blendPreset);
    if (raw !== undefined) {
      const verdict = validateBlendPreset(raw);
      if (!verdict.ok) return verdict;
      updates.blend_preset = verdict.value;
    }
  }

  if (sent(body, 'blendSettings')) {
    const raw = chosen(body.blendSettings);
    if (raw !== undefined) {
      const verdict = validateBlendSettings(raw);
      if (!verdict.ok) return verdict;
      updates.blend_settings = verdict.value;
      clamped = verdict.clamped;
    }
  }

  return { ok: true, updates, clamped };
}

/**
 * Read the four studio slot fields (spec §6).
 *
 * `{}` means "this payload said nothing about slot art" and is what the shipped
 * numeric editor produces — the caller then writes none of the four columns, which
 * is the difference between an untouched row and a reset one.
 *
 * `imageUrl` is checked against the same trust rule the compositing readers use,
 * so an admin cannot save a slot image that the renderer will refuse to fetch.
 * That is a 400 at write time instead of a template that silently composites
 * without its art.
 */
export function parseStudioSlotFields(raw: unknown): SlotFieldsVerdict {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: true, row: {} };
  }
  const body = raw as Record<string, unknown>;
  const row: Record<string, unknown> = {};

  if (body.imageUrl !== undefined) {
    if (body.imageUrl === null) {
      row.image_url = null;
    } else if (typeof body.imageUrl !== 'string' || body.imageUrl.trim() === '') {
      return {
        ok: false,
        code: 'slot_image_not_readable',
        error:
          'A slot image must be a URL or null to clear it. Empty text is neither — leave the field ' +
          'unset to keep the stored image.',
      };
    } else {
      const plan = templateImagePlan(body.imageUrl.trim());
      if (plan.kind === 'refused') {
        return {
          ok: false,
          code: 'slot_image_not_readable',
          error:
            `That slot image cannot be read by the renderer (${plan.reason}). Use an image uploaded ` +
            'through this console, or a host the compositing allowlist names.',
        };
      }
      row.image_url = body.imageUrl.trim();
    }
  }

  if (body.anchor !== undefined) {
    if (typeof body.anchor !== 'string' || !(SLOT_ANCHORS as readonly string[]).includes(body.anchor)) {
      return {
        ok: false,
        code: 'slot_anchor_invalid',
        error: `anchor must be one of ${SLOT_ANCHORS.join(', ')} — ${describeValue(body.anchor)} is not a placement anchor.`,
      };
    }
    row.anchor = body.anchor;
  }

  for (const key of ['bleed', 'faceProtect'] as const) {
    if (body[key] === undefined) continue;
    const value = body[key];
    const column = key === 'faceProtect' ? 'face_protect' : 'bleed';
    if (typeof value === 'boolean') {
      row[column] = value;
      continue;
    }
    // A form field is text; accept only the two words that mean themselves.
    if (value === 'true' || value === 'false') {
      row[column] = value === 'true';
      continue;
    }
    return {
      ok: false,
      code: 'slot_flag_invalid',
      error: `${key} must be true or false — got ${describeValue(value)}.`,
    };
  }

  return { ok: true, row };
}
