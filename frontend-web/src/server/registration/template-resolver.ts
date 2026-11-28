/**
 * Resolves the active compositing template (+ its contestant slot, plus the
 * decorative foreground slots) for a given `connect_contests` contest id, via
 * the `contest_templates.connect_contest_id` bridge column added in
 * supabase/migrations/20270212000000_contest_templates_connect_bridge.sql.
 *
 * The live caller is `src/server/photo-jobs/registry.ts`, which asks this
 * question *before* it queues a render: a contest with no active template
 * queues nothing, because the runner would discover the same fact after
 * downloading the original, presigning a vendor URL and paying for a
 * moderation pass. `photo-pipeline.ts`'s module doc covers why the
 * synchronous `processContestantPhoto` path is no longer what the review
 * request calls.
 *
 * Since P2 the resolver is also the only place the blend columns are read.
 * That is a deliberate concentration: `blend_preset`/`blend_settings` decide
 * which numbers the engine runs on, `photo_mode` decides which placement math
 * it runs, and `image_url`/`anchor`/`bleed`/`face_protect` decide what the
 * compositor draws around the contestant. A runner that could re-derive any of
 * them from a second query would be a runner that can disagree with the
 * registry's run key about which template a job was rendered against.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SlotConfig } from '@/src/lib/rendering/imageCompositor';

// Lazy + memoized for the same reason as supabase-store.ts / contest-store.ts:
// time whenever env is unset (vitest collection, next build).
let supabaseClient: SupabaseClient | null = null;
function getSupabase() {
  if (!supabaseClient) {
    supabaseClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || '',
      { auth: { persistSession: false } },
    );
  }
  return supabaseClient;
}

/**
 * Named rather than inlined because the two `template_slots` reads must not
 * drift: the contestant row and the art row are the same table, and a column
 * added for one path that the other path forgets is a bug that only shows up in
 * the rendered result. `select('*')` was fine while there was one reader; with
 * an explicit list a dropped column fails a test instead of arriving as
 * `undefined` inside a claimed job.
 *
 * `as const` cannot be written here — a `+` concatenation is not a literal
 * expression, and TS1355 says so — but the list must stay ONE string literal for
 * the same reason: postgrest-js parses the select string at the type level, and a
 * value whose type has widened to `string` resolves to its `GenericStringError`
 * row type instead of a row. Split this across lines with `+` and the query stops
 * type-checking, which is the loudest possible outcome for a two-line refactor.
 *
 * Exported because the studio preview needs the same row shape the queue resolves, and
 * a second column list is a second place a new art column can be forgotten.
 */
export const SLOT_COLUMNS = 'id, slot_name, slot_type, slot_order, x, y, width, height, rotation, z_index, scale, crop_mode, border_radius, opacity, image_url, anchor, bleed, face_protect';

/**
 * §11's blend columns on `contest_templates`, plus the identity P1 already needed.
 * Exported for the same reason as `SLOT_COLUMNS`: the preview reads these eight.
 */
export const TEMPLATE_COLUMNS = 'id, version, template_url, width, height, photo_mode, blend_preset, blend_settings';

/** §11's `anchor` domain, validated the way `params.ts` validates `shadow`. */
const ANCHORS = ['auto', 'top', 'centre', 'bottom'] as const;
type Anchor = (typeof ANCHORS)[number];

const asAnchor = (value: unknown): Anchor =>
  (ANCHORS as readonly unknown[]).includes(value) ? (value as Anchor) : 'auto';

export interface ResolvedTemplate {
  /**
   * Identity of the template that was resolved, not just its pixels.
   *
   * The photo job queue keys each render by template, so a template edit that
   * publishes a new version must produce a new job rather than being answered
   * from the completed row of the version before it. That is only expressible
   * if the resolver hands back `id` and `version` — until now it returned the
   * URL and dimensions and dropped both, which meant callers either re-queried
   * the table themselves or built a run key that could not tell two versions
   * apart. Both are selected by the query below, so no caller has to cast the
   * row or re-fetch it to learn which template a job was rendered against.
   */
  templateId: string;
  templateVersion: number;
  templateUrl: string;
  templateWidth: number;
  templateHeight: number;
  slot: SlotConfig;
  /**
   * `contest_templates.photo_mode`: `'auto' | 'background' | 'photo_area'`.
   * `'auto'` for anything the column does not say — §3's inference is what
   * carries a template authored before P2, and `resolvePhotoMode` re-checks the
   * pixels anyway.
   */
  photoMode: string;
  /** `contest_templates.blend_preset`, whose numbers §12 owns. */
  blendPreset: string;
  /**
   * `contest_templates.blend_settings` as the jsonb arrives. Typed `unknown`
   * on purpose: it is operator-authored JSON, and `resolveBlendParams` is the
   * one place that decides what of it is a legal number.
   */
  blendSettings: unknown;
  /**
   * §8.1: the non-`contestant` slots that carry their own art, in `z_index`
   * order. Empty for every template authored so far — `image_url` is new in
   * 20272200000000 and NULL by default — which is what lets the runner append
   * this list to a P1-shaped call without changing what that call draws.
   */
  foregroundSlots: SlotConfig[];
}

/**
 * One row → one `SlotConfig`. The numeric cast mirrors the column types (numeric).
 *
 * Exported for P3 Task 10: the studio preview has to build the same slot the queue
 * will build, and a second copy of this mapping is a second place `anchor`'s domain
 * or `face_protect`'s default can be re-invented and disagree with a render.
 */
export function toSlot(row: Record<string, unknown>): SlotConfig {
  const r = row as typeof row & {
    id: string; slot_name: string; slot_type: string; slot_order: number;
    x: unknown; y: unknown; width: unknown; height: unknown;
    rotation: unknown; z_index: unknown; scale: unknown;
    crop_mode: string; border_radius: unknown; opacity: unknown;
    image_url?: string | null; anchor?: unknown; bleed?: boolean | null; face_protect?: boolean | null;
  };
  return {
    id: r.id,
    slot_name: r.slot_name,
    slot_type: r.slot_type,
    slot_order: Number(r.slot_order),
    x: Number(r.x),
    y: Number(r.y),
    width: Number(r.width),
    height: Number(r.height),
    rotation: Number(r.rotation),
    z_index: Number(r.z_index),
    scale: Number(r.scale),
    crop_mode: r.crop_mode as SlotConfig['crop_mode'],
    border_radius: Number(r.border_radius),
    opacity: Number(r.opacity),
    // §13's and §8.2's fields travel as themselves, with the column's own
    // default where the row is silent: `bleed` and `face_protect` are booleans
    // NOT NULL with defaults, and `anchor` is text whose legal set is `ANCHORS`
    // — a value outside it is not a placement preference, so it becomes 'auto'
    // rather than a string the placement maths has to guess about.
    image_url: r.image_url ?? null,
    anchor: asAnchor(r.anchor),
    bleed: r.bleed ?? false,
    face_protect: r.face_protect ?? true,
    // photo_url intentionally left unset — the caller fills it in with the
    // contestant's own (possibly cutout) photo.
  };
}

/**
 * Look up the highest-version `active` template configured for a
 * connect_contests contest, and its first `contestant` slot (ordered by
 * slot_order). Returns null (never throws) when no template is configured,
 * or when a template exists but has no contestant slot — either case is the
 * expected "not configured yet" state, not an error, so callers should fall
 * back to the no-template pipeline rather than surface a failure.
 */
export async function resolveActiveTemplateForContest(
  connectContestId: string,
): Promise<ResolvedTemplate | null> {
  const supabase = getSupabase();

  const { data: template, error: templateError } = await supabase
    .from('contest_templates')
    .select(TEMPLATE_COLUMNS)
    .eq('connect_contest_id', connectContestId)
    .eq('status', 'active')
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (templateError) {
    console.warn(
      `[template-resolver] Failed to query contest_templates for connect_contest_id=${connectContestId}: ${templateError.message}`,
    );
    return null;
  }

  if (!template) return null;

  const { data: slotRow, error: slotError } = await supabase
    .from('template_slots')
    .select(SLOT_COLUMNS)
    .eq('template_id', template.id)
    .eq('slot_type', 'contestant')
    .order('slot_order', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (slotError) {
    console.warn(
      `[template-resolver] Failed to query template_slots for template_id=${template.id}: ${slotError.message}`,
    );
    return null;
  }

  if (!slotRow) {
    console.warn(
      `[template-resolver] Active template ${template.id} (connect_contest_id=${connectContestId}) has no 'contestant' slot — treating as unresolvable.`,
    );
    return null;
  }

  // §8.1's decorative overlays, newest half of this function's job. Ordered by
  // `z_index` because that is the order the compositor draws them in, and read
  // with a `not(...is null)` rather than a JS filter so the art rows are the
  // only ones that cross the wire.
  //
  // A failure here is logged and answered with an empty list, NOT a null
  // template. The alternative would make the runner fail a claimed job with
  // "the contest has no active template" over a missing laurel — a message that
  // describes neither the fault nor the fix, on a render whose subject is
  // perfectly complete without it.
  const { data: foregroundRows, error: foregroundError } = await supabase
    .from('template_slots')
    .select(SLOT_COLUMNS)
    .eq('template_id', template.id)
    .neq('slot_type', 'contestant')
    .not('image_url', 'is', null)
    .order('z_index', { ascending: true });

  if (foregroundError) {
    console.warn(
      `[template-resolver] Failed to query foreground slots for template_id=${template.id}: ${foregroundError.message} — rendering without them.`,
    );
  }

  return {
    templateId: template.id,
    templateVersion: Number(template.version),
    templateUrl: template.template_url,
    templateWidth: Number(template.width),
    templateHeight: Number(template.height),
    slot: toSlot(slotRow),
    photoMode: template.photo_mode ?? 'auto',
    blendPreset: template.blend_preset ?? 'natural',
    blendSettings: template.blend_settings ?? null,
    foregroundSlots: (foregroundRows ?? []).map(toSlot),
  };
}
