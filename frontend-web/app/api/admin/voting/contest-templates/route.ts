import { randomUUID } from 'crypto';
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { classifyFormDataParseFailure } from '@/src/lib/api/multipart-request';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { describeStorageFailure } from '@/src/lib/storage/storage-error';
import {
  MAX_CONTEST_TEMPLATE_UPLOAD_BYTES,
  MAX_CONTEST_TEMPLATE_UPLOAD_MB,
} from '@/src/lib/storage/upload-limits';
import { mapOverlayRow, mapSlotRow, mapTemplateRow, isValidStatus } from './_shared';
import { effectiveBlendParams, parseStudioTemplateFields, uuidOr } from '@/src/server/template-studio/authoring';

export const BUCKET = 'contest-templates';

/**
 * The formats this route accepts — kept next to the bucket's own
 * `allowed_mime_types` (supabase/migrations/20260405700000_contest_image_templates.sql)
 * and pinned equal to it by tests/unit/voting/contest-template-bucket-policy.spec.ts,
 * because the two drifting is how a legitimate file ends up refused.
 */
export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/svg+xml',
]);

const ACCEPTED_LABEL = 'PNG, JPEG, WebP or SVG';

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

// contest_templates.connect_contest_id and .created_by are UUID columns with
// foreign keys, so anything else is a guaranteed insert failure — better answered
// here, before a single byte reaches storage.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Lists templates (optionally filtered), each with its slots + text overlays
// embedded so the admin UI can render everything from a single call.
export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'votes:manage');
    const { searchParams } = new URL(request.url);
    const connectContestId = searchParams.get('connectContestId');
    const status = searchParams.get('status');

    if (status && !isValidStatus(status)) {
      return errorResponse('Invalid status filter', 400);
    }

    const supabase = createAdminClient();
    let query = supabase.from('contest_templates').select('*').order('created_at', { ascending: false });
    if (connectContestId) query = query.eq('connect_contest_id', connectContestId);
    if (status) query = query.eq('status', status);

    const { data: templateRows, error } = await query;
    if (error) {
      console.error('[admin/voting/contest-templates GET]', error.message);
      return errorResponse('Failed to load templates', 500);
    }

    const templates = templateRows ?? [];
    const templateIds = templates.map((t: any) => t.id);

    let slotsByTemplate = new Map<string, any[]>();
    let overlaysByTemplate = new Map<string, any[]>();

    if (templateIds.length > 0) {
      const [{ data: slotRows, error: slotsError }, { data: overlayRows, error: overlaysError }] =
        await Promise.all([
          supabase
            .from('template_slots')
            .select('*')
            .in('template_id', templateIds)
            .order('slot_order', { ascending: true }),
          supabase
            .from('template_text_overlays')
            .select('*')
            .in('template_id', templateIds)
            .order('z_index', { ascending: true }),
        ]);

      if (slotsError) {
        console.error('[admin/voting/contest-templates GET] slots:', slotsError.message);
        return errorResponse('Failed to load template slots', 500);
      }
      if (overlaysError) {
        console.error('[admin/voting/contest-templates GET] overlays:', overlaysError.message);
        return errorResponse('Failed to load template overlays', 500);
      }

      slotsByTemplate = groupBy(slotRows ?? [], 'template_id');
      overlaysByTemplate = groupBy(overlayRows ?? [], 'template_id');
    }

    const result = templates.map((row: any) => ({
      ...mapTemplateRow(row),
      slots: (slotsByTemplate.get(row.id) ?? []).map(mapSlotRow),
      textOverlays: (overlaysByTemplate.get(row.id) ?? []).map(mapOverlayRow),
    }));

    return successResponse({ success: true, templates: result });
  } catch (error) {
    return handleApiError(error, 'Failed to load contest templates');
  }
}

// POST /api/admin/voting/contest-templates — multipart/form-data
// image), width/height/aspectRatio (optional, default 1080/1080/'1:1').
// Uploads the file to the contest-templates Supabase Storage bucket and
// inserts a new contest_templates row with status:'draft' (never 'active' on
// create — an admin must explicitly activate after configuring slots).
//
// Every rejection on this path names its cause, because the console shows
// `error` verbatim and a bare "Failed to upload template image" gave the admin
// nothing to change (report 2026-11-25: the storage service was simply
// unreachable, which the route knew from its own log line).
export async function POST(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'votes:manage');

    // `request.formData()` answers three different faults with the same TypeError,
    // and the header decides which one this was — see src/lib/api/multipart-request.
    // The old `.catch(() => null)` called a body cut off in transit a content-type
    // problem and blamed the admin's request instead of their file.
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch (parseError) {
      const verdict = classifyFormDataParseFailure(
        request.headers.get('content-type'),
        parseError,
        MAX_CONTEST_TEMPLATE_UPLOAD_BYTES,
      );
      if (verdict.status >= 500) return handleApiError(parseError, verdict.message);
      return errorResponse(
        verdict.message,
        verdict.status,
        verdict.status === 413 ? 'upload_incomplete' : 'multipart_required',
      );
    }
    const name = formData.get('name');
    const connectContestId = formData.get('connectContestId');
    const file = formData.get('file');

    if (typeof name !== 'string' || !name.trim()) {
      return errorResponse('name is required', 400, 'name_required');
    }
    if (typeof connectContestId !== 'string' || !connectContestId.trim()) {
      return errorResponse('connectContestId is required', 400, 'contest_required');
    }
    if (!(file instanceof File)) {
      return errorResponse('file is required', 400, 'file_required');
    }
    // Checked before the upload: contest_templates.connect_contest_id is a UUID
    // with a foreign key to connect_contests, so a slug or a stray string could
    // only fail the insert — after the image had already been written.
    if (!UUID_RE.test(connectContestId)) {
      return errorResponse(
        'connectContestId must be the UUID of a Connect contest, as listed by the contest selector.',
        400,
        'contest_id_invalid',
      );
    }

    // Studio fields (P3, spec §6) join the same pre-upload gate for the same
    // reason: `blendPreset: 'vivid'` is a typo, and a typo that reaches storage
    // leaves a frame PNG no row will ever reference. A multipart part is text, so
    // blendSettings arrives as JSON-in-a-string — validateBlendSettings parses it.
    // An absent part is absent: photo_mode/blend_preset/blend_settings then keep
    // their column defaults, which is what the shipped console still does.
    const studio = parseStudioTemplateFields({
      photoMode: formData.has('photoMode') ? formData.get('photoMode') : undefined,
      blendPreset: formData.has('blendPreset') ? formData.get('blendPreset') : undefined,
      blendSettings: formData.has('blendSettings') ? formData.get('blendSettings') : undefined,
    });
    if (!studio.ok) return errorResponse(studio.error, 400, studio.code);

    // Validate it's an image mime type. The client-supplied File.type is the
    // only signal formData() gives us (unlike the registration uploads route,
    // there's no filename-extension allowlist that's already the source of
    // truth here) — reject anything outside the bucket's own allowed_mime_types
    // (20260405700000_contest_image_templates.sql) rather than trusting an
    // arbitrary value.
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
      return errorResponse(
        `Unsupported file type: ${file.type || 'unknown'}. Template images must be ${ACCEPTED_LABEL}.`,
        400,
        'file_type_unsupported',
      );
    }

    // The bucket's own limit, enforced before the bytes are read: past it the
    // upload travels the whole way and storage answers with a 400 that used to be
    // indistinguishable from every other failure.
    if (file.size > MAX_CONTEST_TEMPLATE_UPLOAD_BYTES) {
      return errorResponse(
        `Image is larger than the ${MAX_CONTEST_TEMPLATE_UPLOAD_MB}MB limit for template images.`,
        413,
        'file_too_large',
      );
    }

    const width = coercePositiveInt(formData.get('width')) ?? 1080;
    const height = coercePositiveInt(formData.get('height')) ?? 1080;
    const aspectRatioRaw = formData.get('aspectRatio');
    const aspectRatio = typeof aspectRatioRaw === 'string' && aspectRatioRaw.trim() ? aspectRatioRaw : '1:1';

    const supabase = createAdminClient();

    const ext = EXT_BY_MIME[file.type] ?? 'png';
    const objectKey = `templates/${connectContestId}/${randomUUID()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(objectKey, buffer, {
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) {
      console.error(
        `[admin/voting/contest-templates POST] storage upload to ${BUCKET}/${objectKey}:`,
        uploadError.message,
        'statusCode=', (uploadError as { statusCode?: string | number }).statusCode ?? 'none',
      );
      const verdict = describeStorageFailure(uploadError, {
        bucket: BUCKET,
        subject: 'template image',
        maxMb: MAX_CONTEST_TEMPLATE_UPLOAD_MB,
        formats: ['PNG', 'JPEG', 'WebP', 'SVG'],
      });
      return errorResponse(verdict.message, verdict.status, verdict.code);
    }

    const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(objectKey);
    const templateUrl = publicUrlData?.publicUrl;
    if (!templateUrl) {
      return errorResponse('Upload succeeded but no public URL could be resolved', 500, 'public_url_unresolved');
    }

    // 'api-key' is what assertAdminPermission returns for an x-admin-key caller
    // (src/server/admin/auth.ts:77). created_by is a UUID referencing
    // user_profiles, so writing it verbatim failed the insert for every
    // server-to-server create — after the image was already uploaded.
    const createdBy = uuidOr(identity?.actorId);

    const { data: inserted, error: insertError } = await supabase
      .from('contest_templates')
      .insert({
        name: name.trim(),
        connect_contest_id: connectContestId,
        contest_id: null,
        template_url: templateUrl,
        file_format: ext,
        width,
        height,
        aspect_ratio: aspectRatio,
        status: 'draft',
        created_by: createdBy,
        ...studio.updates,
      })
      .select('*')
      .single();

    if (insertError) {
      console.error('[admin/voting/contest-templates POST] insert:', insertError.message);
      // The row never landed, so the object is unreachable by anything. Delete it
      // rather than leaving an orphan behind for the next retry to pile onto.
      const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([objectKey]);
      if (cleanupError) {
        console.error('[admin/voting/contest-templates POST] orphan cleanup:', cleanupError.message);
      }
      const verdict = describeInsertFailure(insertError);
      return errorResponse(verdict.message, verdict.status, verdict.code);
    }

    // D5's answer: `effectiveParams` is the number set the compositor will use for
    // this row, read back off the stored row rather than echoed from the request,
    // so a column default the client never sent is included too.
    return successResponse(
      {
        success: true,
        template: { ...mapTemplateRow(inserted), slots: [], textOverlays: [] },
        effectiveParams: effectiveBlendParams(inserted.blend_preset, inserted.blend_settings),
        clamped: studio.clamped,
      },
      201,
    );
  } catch (error) {
    return handleApiError(error, 'Failed to create contest template');
  }
}

/**
 * Why the row insert refused, in terms the admin can act on.
 *
 * PostgREST is informative here and this is an admin-only route, but the upstream
 * text still goes to the log rather than the response: it quotes constraint names
 * and table shapes that read as noise in a console banner.
 */
function describeInsertFailure(error: { code?: string; message?: string; details?: string }): {
  status: number;
  code: string;
  message: string;
} {
  const haystack = `${error.message ?? ''} ${error.details ?? ''}`;

  if (error.code === '23503' || /foreign key constraint/.test(haystack)) {
    if (/connect_contests/.test(haystack)) {
      return {
        status: 400,
        code: 'template_contest_not_found',
        message:
          'That contest does not exist in this environment, so the template could not be linked to it. ' +
          'Pick the contest again from the selector.',
      };
    }
    if (/user_profiles/.test(haystack) || /created_by/.test(haystack)) {
      return {
        status: 400,
        code: 'template_actor_has_no_profile',
        message:
          'Your admin account has no profile row in this environment, so the template could not be ' +
          'attributed. The image was removed again; re-check the account and retry.',
      };
    }
    return {
      status: 500,
      code: 'template_insert_refused',
      message: 'The template references data that is not present in this environment. Nothing was stored.',
    };
  }

  if (error.code === '22P02' || /invalid input syntax/.test(haystack)) {
    return {
      status: 400,
      code: 'template_insert_bad_id',
      message: 'One of the ids sent with the template is not a valid UUID. Nothing was stored.',
    };
  }

  return {
    status: 500,
    code: 'template_insert_failed',
    message: 'Saving the template record failed. The uploaded image was removed again, so you can retry.',
  };
}

function groupBy<T extends Record<string, any>>(rows: T[], key: string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = row[key];
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(row);
  }
  return map;
}

function coercePositiveInt(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}
