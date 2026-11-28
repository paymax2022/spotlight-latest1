import { createAdminClient } from '@/lib/supabase/server';
import { ApiError, errorResponse } from '@/src/lib/api/responses';

const VALID_STATUSES = ['draft', 'active', 'archived'] as const;
export type TemplateStatus = (typeof VALID_STATUSES)[number];

export function isValidStatus(value: unknown): value is TemplateStatus {
  return typeof value === 'string' && (VALID_STATUSES as readonly string[]).includes(value);
}

export function mapTemplateRow(row: any) {
  return {
    id: row.id,
    name: row.name,
    connectContestId: row.connect_contest_id,
    contestId: row.contest_id,
    templateUrl: row.template_url,
    thumbnailUrl: row.thumbnail_url,
    fileFormat: row.file_format,
    width: row.width,
    height: row.height,
    aspectRatio: row.aspect_ratio,
    status: row.status,
    version: row.version,
    parentTemplateId: row.parent_template_id,
    isReusable: row.is_reusable,
    // P2 (20272200000000) and P3 (20272300000000) columns. Read by the studio
    // panel to show what a template will do; `publishedAt` is also the console's
    // "why can't I edit this?" clue, since only a draft is writable (D6).
    photoMode: row.photo_mode,
    blendPreset: row.blend_preset,
    blendSettings: row.blend_settings ?? {},
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSlotRow(row: any) {
  return {
    id: row.id,
    templateId: row.template_id,
    slotName: row.slot_name,
    slotType: row.slot_type,
    slotOrder: row.slot_order,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    rotation: row.rotation,
    zIndex: row.z_index,
    scale: row.scale,
    cropMode: row.crop_mode,
    borderRadius: row.border_radius,
    opacity: row.opacity,
    snapToGrid: row.snap_to_grid,
    gridSize: row.grid_size,
    // P2 slot art. Without these four the console round-trips a slot it cannot
    // see, which is how PUT (a replace) deletes art nobody asked it to delete.
    imageUrl: row.image_url ?? null,
    anchor: row.anchor,
    bleed: row.bleed,
    faceProtect: row.face_protect,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapOverlayRow(row: any) {
  return {
    id: row.id,
    templateId: row.template_id,
    label: row.label,
    fieldType: row.field_type,
    content: row.content,
    x: row.x,
    y: row.y,
    fontSize: row.font_size,
    fontWeight: row.font_weight,
    color: row.color,
    zIndex: row.z_index,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * True if `templateId` currently has at least one `slot_type = 'contestant'`
 * row in template_slots. Shared by:
 *   - PATCH .../[templateId] when moving status -> 'active'
 *   - PUT .../[templateId]/slots when the template's CURRENT status is
 *     already 'active' (replacing the slot list on a live template must not
 *     be able to strip its last contestant slot without an explicit
 *     archive-first step).
 *
 * An active template with no contestant slot is exactly the "looks
 * configured but isn't" trap this module exists to prevent — see brief
 * AD-003/CS-004.
 */
export async function hasContestantSlot(templateId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('template_slots')
    .select('id')
    .eq('template_id', templateId)
    .eq('slot_type', 'contestant')
    .limit(1);

  if (error) {
    // ApiError's message IS the client-facing text — a PostgREST message here
    // would reach the response body verbatim.
    console.error('[admin/voting/contest-templates] slot check failed:', error.message);
    throw new ApiError('Failed to check template slots', 500);
  }
  return Boolean(data && data.length > 0);
}

/**
 * One shape for every studio RPC failure (spec §6's "machine code + a sentence
 * that names the fix").
 *
 * The deliberate difference from `describeStorageFailure`, which refuses to echo
 * upstream text because storage errors quote bucket names and absolute paths: the
 * four studio functions raise their own sentences (`20272300000000`'s
 * `raise exception … using errcode = '22023'`), written for the admin who triggered
 * them — "add one before publishing", "link it to a contest first". Swallowing
 * those into a generic 500 is the exact fault the 2026-11-25 upload report was
 * about, so a `22023` travels through, minus the `function_name: ` prefix that
 * exists for Postgres logs rather than for a banner. That prefix format is pinned
 * by `tests/unit/photo-jobs/template-studio-migration.test.ts`, which requires every
 * raise in the migration to name its own function — so this parser has a contract,
 * not a hope.
 */
const RPC_NAME_PREFIX = /^(duplicate_contest_template|publish_contest_template|archive_contest_template|contest_template_versions):\s*/;

export function studioRpcFailure(
  prefix: string,
  error: { code?: string; message?: string } | null | undefined,
): Response {
  const code = error?.code ?? '';
  const message = error?.message ?? '';
  console.error(`${prefix} studio rpc`, code, message);

  // The functions themselves are missing: this environment has not had the
  // migration applied. Nothing the admin does to the form will fix that.
  if (code === '42P01' || code === '42883' || /does not exist/i.test(message)) {
    if (!/no contest template/i.test(message)) {
      return errorResponse(
        'The template studio functions are not installed in this environment, so publishing, ' +
          'duplicating and archiving cannot run. Migration 20272300000000 has to be applied.',
        500,
        'studio_rpc_missing',
      );
    }
  }

  if (code === '22023') {
    const sentence = message.replace(RPC_NAME_PREFIX, '').trim();
    if (/no contest template/i.test(sentence)) {
      return errorResponse(
        'That template no longer exists, so nothing was changed. Reload the list.',
        404,
        'template_not_found',
      );
    }
    if (/no contestant slot/i.test(sentence)) {
      return errorResponse(sentence, 400, 'publish_needs_contestant_slot');
    }
    if (/no connect contest linked/i.test(sentence)) {
      return errorResponse(sentence, 400, 'publish_needs_connect_contest');
    }
    return errorResponse(sentence || 'The template studio refused that change.', 400, 'studio_refused');
  }

  // Anything else is a server fault whose text is not ours to publish.
  return errorResponse(
    'The template studio could not complete that action. Nothing was changed — try again.',
    500,
    'studio_rpc_failed',
  );
}

/* ---------------------------------------------------------------------------
 * The contest-template upload contract, in one place (Task 11).
 *
 * These four lived inside `route.ts` while it was the only uploader. The studio's
 * slot-art route is the second, and a mime list, a bucket id, a size ceiling and an
 * extension map that exist twice are four chances to disagree — the failure mode the
 * 2026-11-25 upload report was about (a legitimate file refused, or stored with a
 * content type its extension contradicts). `route.ts` re-exports `BUCKET` and
 * `ALLOWED_IMAGE_MIME_TYPES` so the existing importers, including
 * `tests/unit/voting/contest-template-bucket-policy.spec.ts`, keep pinning them
 * against the bucket row in 20260405700000.
 * ------------------------------------------------------------------------- */
export const BUCKET = 'contest-templates';

/**
 * Kept equal to the bucket's own `allowed_mime_types` by
 * `contest-template-bucket-policy.spec.ts`.
 */
export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/svg+xml',
]);

/** The same list, phrased for the admin who is holding a `.tiff`. */
export const ACCEPTED_LABEL = 'PNG, JPEG, WebP or SVG';

/** Stored extension follows the *mime type*, never the client's filename. */
export const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

/**
 * One call site for the four studio functions, so one place maps their failures.
 *
 * `logPrefix` is only for `console.error`: the response body never carries it, because
 * the reason a publish failed is in the sentence the function raised, and a route name
 * adds nothing an admin can act on.
 */
export async function callStudioRpc(
  supabase: ReturnType<typeof createAdminClient>,
  fn: 'duplicate_contest_template' | 'publish_contest_template' | 'archive_contest_template' | 'contest_template_versions',
  args: Record<string, unknown>,
  logPrefix: string,
): Promise<{ ok: true; data: any } | { ok: false; response: Response }> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) return { ok: false, response: studioRpcFailure(logPrefix, error) };
  return { ok: true, data: data ?? null };
}

/**
 * Re-read the row an RPC just changed, so the route answers with stored truth.
 *
 * Every write route in this feature ends by returning `mapTemplateRow(row)` rather than
 * echoing the request: `status`, `version` and `published_at` are decided inside the
 * transaction (`now()`, the trigger, the archive-then-activate order), and D5's rule is
 * that the API states what is stored. A read that fails or comes back empty is a 500, not
 * a 404 — the action DID happen, so telling the admin "not found" would invite a second
 * publish of a template that is already live.
 */
export async function readStudioRow(
  supabase: ReturnType<typeof createAdminClient>,
  templateUuid: string,
  logPrefix: string,
): Promise<{ ok: true; row: any } | { ok: false; response: Response }> {
  const { data, error } = await supabase
    .from('contest_templates')
    .select('*')
    .eq('id', templateUuid)
    .maybeSingle();

  if (error) {
    console.error(`${logPrefix} row read-back:`, error.message);
    return {
      ok: false,
      response: errorResponse('Failed to load template', 500, 'template_read_failed'),
    };
  }
  if (!data) {
    return {
      ok: false,
      response: errorResponse(
        'The template was changed but could not be read back — reload the list before trying again.',
        500,
        'template_readback_missing',
      ),
    };
  }
  return { ok: true, row: data };
}
