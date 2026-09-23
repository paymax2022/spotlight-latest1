/**
 * Resolves the active compositing template (+ its contestant slot) for a
 * given `connect_contests` contest id, via the `contest_templates.
 * connect_contest_id` bridge column added in
 * supabase/migrations/20270212000000_contest_templates_connect_bridge.sql.
 *
 * See src/server/registration/photo-pipeline.ts module doc and
 * supabase-store.ts reviewRegistrationApplication for how this is used:
 * a resolved template lets the review flow call processContestantPhoto
 * (full compositing) instead of processContestantPhotoNoTemplate.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SlotConfig } from '@/src/lib/rendering/imageCompositor';

// Lazy + memoized for the same reason as supabase-store.ts / contest-store.ts:
// a module-level createClient() throws "supabaseUrl is required" at import
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
    .select('id, template_url, width, height')
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
    templateUrl: template.template_url,
    templateWidth: Number(template.width),
    templateHeight: Number(template.height),
    slot,
  };
}
