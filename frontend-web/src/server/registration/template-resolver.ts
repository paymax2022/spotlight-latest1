/**
 * Resolves the active compositing template (+ its contestant slot) for a
 * given `connect_contests` contest id, via the `contest_templates.
 * connect_contest_id` bridge column added in
 * supabase/migrations/20270212000000_contest_templates_connect_bridge.sql.
 *
 * The live caller is `src/server/photo-jobs/registry.ts`, which asks this
 * question *before* it queues a render: a contest with no active template
 * queues nothing, because the runner would discover the same fact after
 * downloading the original, presigning a vendor URL and paying for a
 * moderation pass. `photo-pipeline.ts`'s module doc covers why the
 * synchronous `processContestantPhoto` path is no longer what the review
 * request calls.
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
    .select('id, version, template_url, width, height')
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
    .select('*')
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

  const slot: SlotConfig = {
    id: slotRow.id,
    slot_name: slotRow.slot_name,
    slot_type: slotRow.slot_type,
    slot_order: slotRow.slot_order,
    x: Number(slotRow.x),
    y: Number(slotRow.y),
    width: Number(slotRow.width),
    height: Number(slotRow.height),
    rotation: Number(slotRow.rotation),
    z_index: Number(slotRow.z_index),
    scale: Number(slotRow.scale),
    crop_mode: slotRow.crop_mode,
    border_radius: Number(slotRow.border_radius),
    opacity: Number(slotRow.opacity),
    // photo_url intentionally left unset — the caller fills it in with the
    // contestant's own (possibly cutout) photo.
  };

  return {
    templateId: template.id,
    templateVersion: Number(template.version),
    templateUrl: template.template_url,
    templateWidth: Number(template.width),
    templateHeight: Number(template.height),
    slot,
  };
}
