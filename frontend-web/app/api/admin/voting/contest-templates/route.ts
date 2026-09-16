import { randomUUID } from 'crypto';
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { mapOverlayRow, mapSlotRow, mapTemplateRow, isValidStatus } from './_shared';

const BUCKET = 'contest-templates';

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/svg+xml',
]);

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
};

// GET /api/admin/voting/contest-templates?connectContestId=<uuid>&status=<draft|active|archived>
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
    if (error) return errorResponse(`Failed to load templates: ${error.message}`, 500);

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

      if (slotsError) return errorResponse(`Failed to load template slots: ${slotsError.message}`, 500);
      if (overlaysError) return errorResponse(`Failed to load template overlays: ${overlaysError.message}`, 500);

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
// Fields: name (required), connectContestId (required uuid), file (required
// image), width/height/aspectRatio (optional, default 1080/1080/'1:1').
// Uploads the file to the contest-templates Supabase Storage bucket and
// inserts a new contest_templates row with status:'draft' (never 'active' on
// create — an admin must explicitly activate after configuring slots).
export async function POST(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'votes:manage');

    const formData = await request.formData();
    const name = formData.get('name');
    const connectContestId = formData.get('connectContestId');
    const file = formData.get('file');

    if (typeof name !== 'string' || !name.trim()) {
      return errorResponse('name is required', 400);
    }
    if (typeof connectContestId !== 'string' || !connectContestId.trim()) {
      return errorResponse('connectContestId is required', 400);
    }
    if (!(file instanceof File)) {
      return errorResponse('file is required', 400);
    }

    // Validate it's an image mime type. The client-supplied File.type is the
    // only signal formData() gives us (unlike the registration uploads route,
    // there's no filename-extension allowlist that's already the source of
    // truth here) — reject anything outside the bucket's own allowed_mime_types
    // (20260405700000_contest_image_templates.sql) rather than trusting an
    // arbitrary value.
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
      return errorResponse(`Unsupported file type: ${file.type || 'unknown'}. Must be an image.`, 400);
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
      return errorResponse(`Failed to upload template image: ${uploadError.message}`, 500);
    }

    const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(objectKey);
    const templateUrl = publicUrlData?.publicUrl;
    if (!templateUrl) {
      return errorResponse('Upload succeeded but no public URL could be resolved', 500);
    }

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
        created_by: identity.actorId || null,
      })
      .select('*')
      .single();

    if (insertError) {
      return errorResponse(`Failed to create template: ${insertError.message}`, 500);
    }

    return successResponse(
      { success: true, template: { ...mapTemplateRow(inserted), slots: [], textOverlays: [] } },
      201,
    );
  } catch (error) {
    return handleApiError(error, 'Failed to create contest template');
  }
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
