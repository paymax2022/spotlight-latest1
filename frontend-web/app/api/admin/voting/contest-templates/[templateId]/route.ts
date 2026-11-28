import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { isValidStatus, mapOverlayRow, mapSlotRow, mapTemplateRow, studioRpcFailure } from '../_shared';
import {
  effectiveBlendParams,
  isEditableStatus,
  parseStudioTemplateFields,
  uuidOr,
} from '@/src/server/template-studio/authoring';

type RouteContext = { params: Promise<{ templateId: string }> };

// GET /api/admin/voting/contest-templates/[templateId] — single template with slots+overlays.
export async function GET(request: Request, ctx: RouteContext) {
  try {
    await assertAdminPermission(request, 'votes:manage');
    const { templateId } = await ctx.params;

    const supabase = createAdminClient();
    const { data: template, error } = await supabase
      .from('contest_templates')
      .select('*')
      .eq('id', templateId)
      .maybeSingle();

    if (error) {
      console.error('[admin/voting/contest-templates GET]', error.message);
      return errorResponse('Failed to load template', 500);
    }
    if (!template) return errorResponse('Template not found', 404);

    const [{ data: slotRows, error: slotsError }, { data: overlayRows, error: overlaysError }] =
      await Promise.all([
        supabase.from('template_slots').select('*').eq('template_id', templateId).order('slot_order', { ascending: true }),
        supabase
          .from('template_text_overlays')
          .select('*')
          .eq('template_id', templateId)
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

    return successResponse({
      success: true,
      template: {
        ...mapTemplateRow(template),
        slots: (slotRows ?? []).map(mapSlotRow),
        textOverlays: (overlayRows ?? []).map(mapOverlayRow),
      },
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load contest template');
  }
}

// PATCH /api/admin/voting/contest-templates/[templateId]
// Allows updating name/status/width/height/aspectRatio, plus the three studio
// fields (photoMode/blendPreset/blendSettings) — on a draft only.
//
// Two rules live here that the route did not have before P3:
//
// - **A published row keeps its rendering parameters** (spec §5 D6). `active` is
//   the row a queued job resolves and a delivered `contest_photo_assets` row
//   points at; `archived` is that same history one step later. Writing
//   `blend_preset` onto either would silently change what past renders claim, so
//   the answer is 409 `template_is_published` and the duplicate route, which mints
//   the new id D1 wants. The refusal happens before the update object is built: a
//   request that also renames the template must not apply the half that was legal,
//   because an admin cannot tell which of two sliders moved.
//   `status` itself stays writable on any row — it is lifecycle, not a blend
//   number, and archiving is how an admin gets out of an active state at all
//   (`DELETE` refuses an active row).
//
// - **Activating is the publish RPC, not an UPDATE** (spec §5 D2/D6). The old
//   route set `status='active'` after a local `hasContestantSlot()` read, which is
//   how one contest ended up with two active templates: nothing archived the
//   first. `publish_contest_template` archives the others in the same transaction
//   and stamps `published_at`/`published_by`, so the route calls it and re-reads
//   the row instead of trusting its own write.
//
// connect_contest_id and contest_id remain immutable after creation — an admin who
// needs the template on a different contest must create a new one.
export async function PATCH(request: Request, ctx: RouteContext) {
  try {
    const identity = await assertAdminPermission(request, 'votes:manage');
    const { templateId } = await ctx.params;
    const body = await request.json().catch(() => null);
    if (!body) return errorResponse('Invalid JSON body', 400);

    const supabase = createAdminClient();
    const { data: existing, error: fetchError } = await supabase
      .from('contest_templates')
      .select('id, status')
      .eq('id', templateId)
      .maybeSingle();

    if (fetchError) {
      console.error('[admin/voting/contest-templates PATCH]', fetchError.message);
      return errorResponse('Failed to load template', 500);
    }
    if (!existing) return errorResponse('Template not found', 404);

    // Validate the studio fields before deciding anything about the row's status:
    // 'vivid' is a mistake whatever the template is, and a 409 would send the admin
    // off to duplicate a template before finding out the preset name was the problem.
    const studio = parseStudioTemplateFields(body as Record<string, unknown>);
    if (!studio.ok) return errorResponse(studio.error, 400, studio.code);

    const writesStudioFields = Object.keys(studio.updates).length > 0;
    if (writesStudioFields && !isEditableStatus((existing as any).status)) {
      return errorResponse(
        `A ${String((existing as any).status)} template is the row past renders were produced from, so its ` +
          'blend and photo settings are read-only. Duplicate it to edit: the copy comes back as a new draft ' +
          'with a new version and the same slots.',
        409,
        'template_is_published',
      );
    }

    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || !body.name.trim()) {
        return errorResponse('name must be a non-empty string', 400);
      }
      updates.name = body.name.trim();
    }

    if (body.width !== undefined) updates.width = body.width;
    if (body.height !== undefined) updates.height = body.height;
    if (body.aspectRatio !== undefined) updates.aspect_ratio = body.aspectRatio;

    Object.assign(updates, studio.updates);

    let wantsPublish = false;
    if (body.status !== undefined) {
      if (!isValidStatus(body.status)) {
        return errorResponse("status must be one of 'draft', 'active', 'archived'", 400);
      }
      // 'active' is the publish RPC's job, so it never enters the UPDATE payload.
      if (body.status === 'active') wantsPublish = true;
      else updates.status = body.status;
    }

    // connect_contest_id / contest_id are deliberately not settable here.

    if (Object.keys(updates).length === 0 && !wantsPublish) {
      return errorResponse('No updatable fields provided', 400);
    }

    let row: any = null;

    if (Object.keys(updates).length > 0) {
      const { data: updated, error: updateError } = await supabase
        .from('contest_templates')
        .update(updates)
        .eq('id', templateId)
        .select('*')
        .single();

      if (updateError) {
        console.error('[admin/voting/contest-templates PATCH] update:', updateError.message);
        return errorResponse('Failed to update template', 500);
      }
      row = updated;
    }

    let archivedIds: string[] = [];

    if (wantsPublish) {
      const { data: published, error: rpcError } = await supabase.rpc('publish_contest_template', {
        p_template_id: templateId,
        p_actor: uuidOr(identity?.actorId),
      });
      if (rpcError) return studioRpcFailure('[admin/voting/contest-templates PATCH]', rpcError);

      // Always answer with a fresh read, even when this request also carried field
      // updates: the UPDATE returned the row as it was *before* the publish, so its
      // `status`/`published_at`/`version` are stale by exactly the fields the RPC
      // just wrote. The console needs to see the state it is now in.
      const read = await supabase.from('contest_templates').select('*').eq('id', templateId).maybeSingle();
      if (read.error) {
        console.error('[admin/voting/contest-templates PATCH] re-read:', read.error.message);
        return errorResponse('Published the template but could not read it back', 500);
      }
      if (!read.data) return errorResponse('Published the template but it is no longer present', 500);
      row = read.data;
      archivedIds = Array.isArray((published as any)?.archived_ids)
        ? ((published as any).archived_ids as string[])
        : [];
    }

    return successResponse({
      success: true,
      template: mapTemplateRow(row),
      effectiveParams: effectiveBlendParams(row.blend_preset, row.blend_settings),
      clamped: studio.clamped,
      ...(wantsPublish ? { archivedIds } : {}),
    });
  } catch (error) {
    return handleApiError(error, 'Failed to update contest template');
  }
}

// DELETE /api/admin/voting/contest-templates/[templateId]
// Hard delete (cascades to slots/overlays). Refused with 409 while the
// template is 'active' — an admin must archive it first, so a live
// compositing path is never killed with no warning.
export async function DELETE(request: Request, ctx: RouteContext) {
  try {
    await assertAdminPermission(request, 'votes:manage');
    const { templateId } = await ctx.params;

    const supabase = createAdminClient();
    const { data: existing, error: fetchError } = await supabase
      .from('contest_templates')
      .select('id, status')
      .eq('id', templateId)
      .maybeSingle();

    if (fetchError) {
      console.error('[admin/voting/contest-templates DELETE]', fetchError.message);
      return errorResponse('Failed to load template', 500);
    }
    if (!existing) return errorResponse('Template not found', 404);

    if ((existing as any).status === 'active') {
      return errorResponse('Cannot delete an active template — archive it first.', 409);
    }

    const { error: deleteError } = await supabase.from('contest_templates').delete().eq('id', templateId);
    if (deleteError) {
      console.error('[admin/voting/contest-templates DELETE]', deleteError.message);
      return errorResponse('Failed to delete template', 500);
    }

    return successResponse({ success: true });
  } catch (error) {
    return handleApiError(error, 'Failed to delete contest template');
  }
}
