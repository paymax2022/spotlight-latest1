/**
 * POST /api/admin/voting/contest-templates/[templateId]/slot-art
 *
 * Slot art (the P2 `template_slots.image_url` ribbon/frame/watermark) is uploaded here and
 * then attached by the existing `PUT …/slots`, which is the only place slot rows are
 * written. So this route produces a URL and nothing else — it never touches
 * `template_slots`, and the slot replace keeps its single-writer semantics.
 *
 * It reuses the frame-upload contract from `_shared.ts` rather than a parallel one, because
 * the two upload paths disagreeing about the bucket, the mime list, or the extension map is
 * how a legitimate file ends up refused. Three refusals happen *before* a byte is written:
 *
 * - oversized / unsupported type — the same ceilings the frame upload states, so the console
 *   can show one sentence for both;
 * - unknown template — 404, because the object key is namespaced by the template id;
 * - a template that is not a draft — D6. Art uploaded against an `active` row can never be
 *   attached (the slot PUT refuses the whole payload), so the object would be stranded in
 *   the bucket with no row pointing at it and no route that would ever clean it up. The
 *   answer names the way forward: duplicate, then upload against the draft.
 */
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
import {
  ACCEPTED_LABEL,
  ALLOWED_IMAGE_MIME_TYPES,
  BUCKET,
  EXT_BY_MIME,
} from '../../_shared';
import { isEditableStatus, uuidOr } from '@/src/server/template-studio/authoring';

type RouteContext = { params: Promise<{ templateId: string }> };

/** Storage needs the Node runtime; an upload is never a cached route. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request, ctx: RouteContext) {
  try {
    await assertAdminPermission(request, 'votes:manage');
    const { templateId } = await ctx.params;
    const templateUuid = uuidOr(templateId);
    if (!templateUuid) {
      return errorResponse('templateId must be the UUID of a contest template.', 400, 'template_id_invalid');
    }

    let form: FormData;
    try {
      form = await request.formData();
    } catch (parseError) {
      const verdict = classifyFormDataParseFailure(
        request.headers.get('content-type'),
        parseError,
        MAX_CONTEST_TEMPLATE_UPLOAD_BYTES,
      );
      if (verdict.status >= 500) return handleApiError(parseError, verdict.message);
      return errorResponse(verdict.message, verdict.status, 'multipart_unreadable');
    }

    const file = form.get('file');
    if (!(file instanceof File)) return errorResponse('file is required', 400, 'file_required');

    // Same order as the frame upload: the cheap client errors first, so a 50MB `.mov` is
    // refused on its type before the size sentence, and neither reads a row.
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
      return errorResponse(
        `Unsupported file type: ${file.type || 'unknown'}. Slot art must be ${ACCEPTED_LABEL}.`,
        400,
        'file_type_unsupported',
      );
    }
    if (file.size > MAX_CONTEST_TEMPLATE_UPLOAD_BYTES) {
      return errorResponse(
        `Image is larger than the ${MAX_CONTEST_TEMPLATE_UPLOAD_MB}MB limit for template images.`,
        413,
        'file_too_large',
      );
    }

    const supabase = createAdminClient();
    const { data: template, error: fetchError } = await supabase
      .from('contest_templates')
      .select('id, status')
      .eq('id', templateUuid)
      .maybeSingle();
    if (fetchError) {
      console.error('[admin/voting/contest-templates/slot-art POST]', fetchError.message);
      return errorResponse('Failed to load template', 500, 'template_read_failed');
    }
    if (!template) return errorResponse('Template not found', 404, 'template_not_found');
    if (!isEditableStatus((template as any).status)) {
      return errorResponse(
        `This template is ${(template as any).status}, so its art is fixed (D6). Duplicate it and edit the draft.`,
        409,
        'template_is_published',
      );
    }

    const ext = EXT_BY_MIME[file.type] ?? 'png';
    const objectKey = `slots/${templateUuid}/${randomUUID()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(objectKey, buffer, {
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) {
      console.error(
        `[admin/voting/contest-templates/slot-art POST] storage upload to ${BUCKET}/${objectKey}:`,
        uploadError.message,
      );
      const verdict = describeStorageFailure(uploadError, {
        bucket: BUCKET,
        subject: 'slot image',
        maxMb: MAX_CONTEST_TEMPLATE_UPLOAD_MB,
        formats: ['PNG', 'JPEG', 'WebP', 'SVG'],
      });
      return errorResponse(verdict.message, verdict.status, verdict.code);
    }

    const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(objectKey);
    const imageUrl = publicUrlData?.publicUrl;
    if (!imageUrl) {
      return errorResponse('Upload succeeded but no public URL could be resolved', 500, 'public_url_unresolved');
    }

    return successResponse({ success: true, imageUrl }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to upload slot art');
  }
}
