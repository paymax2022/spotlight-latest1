/**
 * The studio's synchronous preview (spec §5, §9, and decisions D3, D4, D5).
 *
 * One function answers the question an operator is actually asking — "what will a
 * portrait on this template look like?" — before the template is published and
 * before any contestant's photograph is spent on it. That is the whole of its job,
 * and three rules shape how it does it:
 *
 * - **D3: it writes nothing.** No asset row, no object, no queued work. The bytes
 *   go back in the response and are then forgotten, which is what lets an operator
 *   press "preview" eleven times while iterating on a feather radius. A test in
 *   `tests/unit/voting/template-studio-preview.test.ts` scans this file for the
 *   write surface to keep that promise from rotting into a comment.
 * - **D4: the sample is a cut-out the admin supplied, never a contestant's photo.**
 *   The gate for that is `hasAlpha`, because a photograph straight off a phone has
 *   no alpha channel and a vendor matte always does. Refusing on that fact is also
 *   the honest answer: an opaque square previewed over a template is a picture of a
 *   sticker, not of the render.
 * - **D5: the numbers are the renderer's.** `blend_settings` is validated and
 *   clamped through `authoring.ts`, which reads `blend/params.ts`'s own `BOUNDS`,
 *   and the effective set travels back in the decisions. The studio therefore
 *   cannot show one image and store another.
 *
 * The pixels come from `compositeWithBlend` — the same call the runner makes, which
 * is the reason this file exists rather than a lighter re-implementation: preview
 * and publish drift exactly when two places decide "blend, then draw". The slot
 * mapping is the resolver's `toSlot` for the same reason.
 *
 * What it does *not* do is choose the row. The route reads `contest_templates` and
 * its `template_slots` and hands them over, so this module stays free of a database
 * client and every branch below is testable with stubbed bytes.
 */
import sharp from 'sharp';
import { compositeWithBlend, type BlendOverrides } from '@/src/lib/rendering/blend/composite';
import { resolveBlendParams, type BlendParams, type BlendPresetName } from '@/src/lib/rendering/blend/params';
import { readTemplateImage } from '@/src/lib/media/template-image';
import { MAX_CONTEST_TEMPLATE_UPLOAD_BYTES, MAX_CONTEST_TEMPLATE_UPLOAD_MB } from '@/src/lib/storage/upload-limits';
import { toSlot } from '@/src/server/registration/template-resolver';
import type { SlotConfig } from '@/src/lib/rendering/imageCompositor';
import { validateBlendPreset, validateBlendSettings, validatePhotoMode } from './authoring';

/**
 * The same cap the template upload itself imposes. The preview is the one path that
 * decodes a caller's bytes synchronously and walks them pixel-by-pixel in
 * `measureSubject`, so an uncapped sample is a request-time CPU bill rather than a
 * storage one; reusing the upload constant keeps "the file the bucket accepts" and
 * "the file the preview accepts" one number.
 */
export const MAX_SAMPLE_BYTES = MAX_CONTEST_TEMPLATE_UPLOAD_BYTES;
export const MAX_SAMPLE_MB = MAX_CONTEST_TEMPLATE_UPLOAD_MB;

/**
 * Longest side a preview will composite.
 *
 * A preview is looked at, not printed, so nothing about the answer improves past a
 * few thousand pixels — while the cost of `refineEdges`, the ring measurement and
 * the shadow layers all scale with the area. The *renderer* has no such cap: this
 * refuses only the synchronous path, and the message says so rather than letting a
 * large template read as "broken".
 */
export const MAX_PREVIEW_SIDE = 4096;

/** The eight `contest_templates` columns a preview reads, as the route selects them. */
export interface PreviewTemplateRow {
  id?: string;
  version?: number;
  template_url?: string | null;
  width?: unknown;
  height?: unknown;
  photo_mode?: string | null;
  blend_preset?: string | null;
  blend_settings?: unknown;
}

/**
 * Unsaved editor state. Every field is optional and wins over the row: the point of
 * the preview is to answer about the template as it is being edited, not as it was
 * last published.
 */
export interface PreviewOverrides {
  photoMode?: string | null;
  blendPreset?: string | null;
  blendSettings?: unknown;
  xOffset?: number;
  yOffset?: number;
  scale?: number;
}

export interface PreviewInput {
  /** `null` is a real state — the route looked and the id is not a row. */
  template: PreviewTemplateRow | null;
  slotRows: readonly Record<string, unknown>[];
  sampleBytes: Buffer | null;
  overrides?: PreviewOverrides;
}

export interface PreviewRefusal {
  ok: false;
  status: number;
  code: string;
  error: string;
}

export interface PreviewSuccess {
  ok: true;
  buffer: Buffer;
  mimeType: string;
  width: number;
  height: number;
  /** The renderer's decision record, plus the `params` the numbers came from. */
  decisions: Record<string, unknown>;
  params: BlendParams;
  clamped: string[];
}

export type PreviewResult = PreviewSuccess | PreviewRefusal;

const refuse = (status: number, code: string, error: string): PreviewRefusal => ({ ok: false, status, code, error });

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Pick the two slot sets out of raw `template_slots` rows, by the resolver's rules.
 *
 * Exported and pure on purpose: these are the rules that decide whether a ribbon
 * ends up over the contestant or under them, and the resolver reaches them through
 * two SQL `order`/`where` clauses that no unit test can exercise without a
 * database. Ordering here (rather than trusting the query's `order`) is what makes
 * the preview and the render agree whatever the route's `select` looked like.
 */
export function selectPreviewSlots(
  rows: readonly Record<string, unknown>[],
): { contestant: SlotConfig | null; foreground: SlotConfig[] } {
  const byOrder = (a: Record<string, unknown>, b: Record<string, unknown>) => Number(a.slot_order) - Number(b.slot_order);
  const byZ = (a: Record<string, unknown>, b: Record<string, unknown>) => Number(a.z_index) - Number(b.z_index);

  const contestantRows = rows.filter((r) => r.slot_type === 'contestant').sort(byOrder);
  const artRows = rows
    .filter((r) => r.slot_type !== 'contestant')
    .filter((r) => typeof r.image_url === 'string' && (r.image_url as string).trim() !== '')
    .sort(byZ);

  return {
    contestant: contestantRows.length > 0 ? toSlot(contestantRows[0]) : null,
    foreground: artRows.map(toSlot),
  };
}

/**
 * Composite one preview, or explain in one sentence why it did not happen.
 *
 * The checks run cheapest-first: everything that can be decided from the row and
 * the form's own fields (size, geometry, field domains) is answered before a pixel
 * is decoded, and no frame read is paid for unless the sample is already usable.
 * That order is observable — the tests assert `readTemplateImage` was never called
 * on the refusals — and it is what keeps a mistyped preset from costing a storage
 * fetch.
 */
export async function buildPreview(input: PreviewInput): Promise<PreviewResult> {
  const row = input.template;
  if (!row) {
    return refuse(404, 'template_not_found', 'No contest template row was found for this id, so there is nothing to preview against.');
  }

  const sample = input.sampleBytes;
  if (!sample || sample.byteLength === 0) {
    return refuse(
      400,
      'sample_required',
      'A sample portrait is required. Send the image as the multipart field named "sample" — a cut-out matte, not a full photograph.',
    );
  }
  if (sample.byteLength > MAX_SAMPLE_BYTES) {
    return refuse(
      413,
      'sample_too_large',
      `That sample is ${(sample.byteLength / (1024 * 1024)).toFixed(1)}MB. Previews accept at most ${MAX_SAMPLE_MB}MB, the same ceiling as a template upload.`,
    );
  }

  const width = Number(row.width);
  const height = Number(row.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return refuse(
      409,
      'template_geometry_invalid',
      `This template row does not state a usable canvas (width ${String(row.width)}, height ${String(row.height)}). ` +
        'Re-upload the background or duplicate the template to set its size.',
    );
  }
  if (Math.max(width, height) > MAX_PREVIEW_SIDE) {
    return refuse(
      400,
      'canvas_too_large',
      `A ${width}×${height} template is too large to preview in the browser's request window (limit ${MAX_PREVIEW_SIDE}px per side). ` +
        'Contestant photos still render at full size.',
    );
  }

  // Fields first, because a refusal here must not look like a render that happened.
  const o = input.overrides ?? {};
  if (o.photoMode !== undefined && o.photoMode !== null) {
    const verdict = validatePhotoMode(o.photoMode);
    if (!verdict.ok) return refuse(400, verdict.code, verdict.error);
  }
  if (o.blendPreset !== undefined && o.blendPreset !== null) {
    const verdict = validateBlendPreset(o.blendPreset);
    if (!verdict.ok) return refuse(400, verdict.code, verdict.error);
  }

  const settingsSource = o.blendSettings !== undefined ? o.blendSettings : (row.blend_settings ?? {});
  const settings = validateBlendSettings(settingsSource);
  if (!settings.ok) return refuse(400, settings.code, settings.error);

  for (const key of ['xOffset', 'yOffset', 'scale'] as const) {
    const value = o[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return refuse(
        400,
        'override_not_a_number',
        `"${key}" must be a finite number when the form sends one — got ${String(value)}. Leave the field empty to use the template's own placement.`,
      );
    }
  }

  // D4's gate. `hasAlpha` is the cheapest truth available: a phone photograph is
  // 3-channel, a vendor matte is 4-channel with real transparent pixels. Decoding
  // failure is its own code because the fix is different (re-attach the file vs
  // run the background removal first).
  let hasAlpha: boolean;
  try {
    hasAlpha = (await sharp(sample).metadata()).hasAlpha === true;
  } catch (err) {
    return refuse(400, 'sample_unreadable', `The sample could not be decoded as an image: ${messageOf(err)}`);
  }
  if (!hasAlpha) {
    return refuse(
      415,
      'sample_needs_cutout',
      'The preview needs a cut-out — a portrait with transparent pixels around the subject — rather than a whole photograph. ' +
        'An opaque sample previews a pasted rectangle, not the blend, and a real contestant photo is never used for a preview.',
    );
  }

  const { contestant, foreground } = selectPreviewSlots(input.slotRows);
  if (!contestant) {
    return refuse(
      400,
      'no_contestant_slot',
      "This template has no 'contestant' slot, so there is nowhere to place the portrait. Add one in the slot editor — a render with no contestant window is refused the same way.",
    );
  }

  const frame = await readTemplateImage(row.template_url ?? null);
  if (!frame.ok) {
    return refuse(
      409,
      `template_bytes_unreadable:${frame.reason}`,
      `The template's own pixels could not be read (${frame.reason}), so the preview cannot composite against them.`,
    );
  }

  const presetName = (o.blendPreset ?? row.blend_preset ?? 'natural') as BlendPresetName;
  const params = resolveBlendParams(presetName, settings.value);
  const declaredMode = (o.photoMode ?? row.photo_mode ?? 'auto') as string;
  const nudges: BlendOverrides = { xOffset: o.xOffset, yOffset: o.yOffset, scale: o.scale };

  // No `fallback` argument: the runner's fallback is a URL-shaped paste it can
  // re-fetch, and the preview has neither a stored subject nor a reason to keep a
  // second copy of either. A throw here is a genuine failure of the composite, and
  // it is reported rather than hidden behind an unblended image that would look
  // like an answer.
  try {
    const rendered = await compositeWithBlend({
      templatePng: frame.bytes,
      canvas: { width, height },
      slot: contestant,
      foregroundSlots: foreground,
      subjectPng: sample,
      params,
      photoMode: declaredMode,
      overrides: nudges,
    });

    return {
      ok: true,
      buffer: rendered.buffer,
      mimeType: rendered.mimeType,
      width: rendered.width,
      height: rendered.height,
      // `params` rides along with the engine's own record so the console can show
      // the number it sent, the number that won, and which knobs were clamped —
      // D5's promise, in the one header the preview already returns.
      decisions: { ...rendered.decisions, params: { preset: params.preset, effective: params, clamped: settings.clamped } },
      params,
      clamped: settings.clamped,
    };
  } catch (err) {
    return refuse(409, 'preview_render_failed', `The preview render failed: ${messageOf(err)}`);
  }
}
